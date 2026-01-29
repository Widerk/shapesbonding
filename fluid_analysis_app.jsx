import React, { useState, useMemo, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  onSnapshot, 
  deleteDoc, 
} from 'firebase/firestore';
import { 
  getAuth, 
  signInAnonymously, 
  signInWithCustomToken, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  Settings, 
  Droplets, 
  Save, 
  Trash2, 
  Ruler,
  History,
  Cloud,
  CloudOff,
  Maximize2,
  Info
} from 'lucide-react';

// --- Configuración de Firebase ---
// Estas variables son inyectadas por el entorno. Si lo corres localmente,
// debes reemplazar __firebase_config con tu objeto de configuración real.
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'fluid-shape-pro-default';

const App = () => {
  const [user, setUser] = useState(null);
  const [params, setParams] = useState({
    A: "100", B: "40", C: "15", D: "20", E: "50",
    L_start: "0.0", L_end: "1.0", rho: "1121.7"
  });

  const [history, setHistory] = useState([]);
  const [isNaming, setIsNaming] = useState(false);
  const [tempName, setTempName] = useState("");

  // (1) Gestión de Autenticación
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Error de autenticación:", error);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // (2) Escucha de datos en tiempo real (Cloud Sync)
  useEffect(() => {
    if (!user) return;
    const historyRef = collection(db, 'artifacts', appId, 'public', 'data', 'profiles');
    const unsubscribe = onSnapshot(historyRef, 
      (snapshot) => {
        const loadedHistory = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        // Ordenar por fecha de creación
        setHistory(loadedHistory.sort((a, b) => b.timestampMs - a.timestampMs));
      },
      (error) => console.error("Error en Firestore:", error)
    );
    return () => unsubscribe();
  }, [user]);

  // --- Lógica de Cálculo ---
  const numericParams = useMemo(() => {
    return Object.keys(params).reduce((acc, key) => {
      acc[key] = parseFloat(params[key]) || 0;
      return acc;
    }, {});
  }, [params]);

  const effectiveLength = useMemo(() => {
    const diff = numericParams.L_end - numericParams.L_start;
    return diff > 0 ? diff : 0;
  }, [numericParams.L_start, numericParams.L_end]);

  const analysis = useMemo(() => {
    const { A, B, C, D, E, rho } = numericParams;
    // Definición de vértices del polígono
    const points = [[0, 0], [A, 0], [A, D], [E, B], [0, C]];
    
    // Cálculo de Área (Fórmula de la lazada / Shoelace)
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      area += (x1 * y2 - x2 * y1);
    }
    area = Math.abs(area) / 2;

    // Cálculo de Perímetro (Suma de distancias entre vértices)
    let perimeter = 0;
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      perimeter += Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    }

    const rh = area / perimeter || 0;
    const volMm3 = area * (effectiveLength * 1000);
    const massKg = (volMm3 / 1e9) * rho;

    // Cálculo del Centroide (Cx, Cy)
    let cx = 0, cy = 0;
    if (area > 0) {
      for (let i = 0; i < points.length; i++) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[(i + 1) % points.length];
        const common = (x1 * y2 - x2 * y1);
        cx += (x1 + x2) * common;
        cy += (y1 + y2) * common;
      }
      cx /= (6 * area);
      cy /= (6 * area);
    }

    return { area, rh, volMm3, massKg, cx: Math.abs(cx), cy: Math.abs(cy), points };
  }, [numericParams, effectiveLength]);

  // --- Operaciones Cloud (Firestore) ---
  const confirmSave = async () => {
    if (!user) return;
    const finalName = tempName.trim() || `Perfil ${history.length + 1}`;
    const docId = finalName.toLowerCase().replace(/\s+/g, '_');
    const profileRef = doc(db, 'artifacts', appId, 'public', 'data', 'profiles', docId);

    const data = {
      name: finalName,
      params: { ...params },
      area: analysis.area.toFixed(2),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestampMs: Date.now(),
      createdBy: user.uid
    };

    try {
      await setDoc(profileRef, data);
      setIsNaming(false);
      setTempName("");
    } catch (error) {
      console.error("Error al guardar:", error);
    }
  };

  const deleteProfile = async (id, e) => {
    e.stopPropagation();
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'profiles', id));
    } catch (error) {
      console.error("Error al borrar:", error);
    }
  };

  const handleParamChange = (key, val) => setParams(prev => ({ ...prev, [key]: val }));

  // --- Renderizado de Gráficos SVG ---
  const renderDimensions = () => {
    const { A, B, C, D, E } = numericParams;
    const maxY = Math.max(B, C, D);
    // Valor estático para etiquetas laterales solicitado por el usuario
    const fixedTextY = -5; 

    return (
      <g className="text-[7px] font-mono fill-slate-400 stroke-slate-500/50" strokeWidth="0.5">
        {/* Cota A (Base) */}
        <line x1="0" y1="-15" x2={A} y2="-15" />
        <line x1="0" y1="-13" x2="0" y2="-17" />
        <line x1={A} y1="-13" x2={A} y2="-17" />
        <text x={A/2} y="22" textAnchor="middle" transform="scale(1, -1)">A: {A}</text>

        {/* Cota C (Altura Izquierda) */}
        <line x1="-15" y1="0" x2="-15" y2={C} />
        <line x1="-13" y1="0" x2="-17" y2="0" />
        <line x1="-13" y1={C} x2="-17" y2={C} />
        <text 
          x="-22" 
          y={-fixedTextY} 
          textAnchor="middle" 
          dominantBaseline="middle"
          transform={`rotate(-90, -22, ${-fixedTextY}) scale(1, -1)`}
        >
          C: {C}
        </text>

        {/* Cota D (Altura Derecha) */}
        <line x1={A + 15} y1="0" x2={A + 15} y2={D} />
        <line x1={A + 13} y1="0" x2={A + 17} y2="0" />
        <line x1={A + 13} y1={D} x2={A + 17} y2={D} />
        <text 
          x={A + 22} 
          y={-fixedTextY} 
          textAnchor="middle" 
          dominantBaseline="middle"
          transform={`rotate(90, ${A + 22}, ${-fixedTextY}) scale(1, -1)`}
        >
          D: {D}
        </text>

        {/* Cota B (Pico) */}
        <line x1={E + 8} y1="0" x2={E + 8} y2={B} strokeDasharray="1,1" />
        <line x1={E + 6} y1={B} x2={E + 10} y2={B} />
        <text x={E + 12} y={-B} textAnchor="start" transform="scale(1, -1)">B: {B}</text>

        {/* Cota E (Posición Pico) */}
        <line x1="0" y1={maxY + 15} x2={E} y2={maxY + 15} strokeDasharray="2,1" />
        <line x1={E} y1={B} x2={E} y2={maxY + 17} />
        <text x={E/2} y={-(maxY + 22)} textAnchor="middle" transform="scale(1, -1)">E: {E}</text>
      </g>
    );
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 p-4 md:p-8 font-sans">
      {/* Modal para Guardado con Nombre */}
      {isNaming && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 p-6 rounded-2xl shadow-2xl w-full max-w-sm space-y-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Save size={20} className="text-blue-400" /> Guardar Perfil
            </h3>
            <p className="text-xs text-slate-400 italic">Los perfiles con el mismo nombre se sobreescriben en la nube.</p>
            <input 
              autoFocus
              type="text"
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmSave()}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white focus:border-blue-500 outline-none"
              placeholder="Nombre del perfil..."
            />
            <div className="flex gap-3 pt-2">
              <button onClick={() => setIsNaming(false)} className="flex-1 px-4 py-2 rounded-xl bg-slate-700 text-sm font-bold hover:bg-slate-600">Cancelar</button>
              <button onClick={confirmSave} className="flex-1 px-4 py-2 rounded-xl bg-blue-600 text-sm font-bold hover:bg-blue-500">Confirmar</button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto">
        {/* Encabezado Principal */}
        <header className="flex items-center justify-between mb-8 border-b border-slate-700 pb-4">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg shadow-lg shadow-blue-500/20">
              <Droplets className="text-white" size={24} />
            </div>
            <h1 className="text-2xl font-black tracking-tighter uppercase italic">Fluid Shape <span className="text-blue-400 not-italic text-sm font-mono tracking-normal">Cloud 3.5</span></h1>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-mono bg-slate-800/80 px-4 py-1.5 rounded-full border border-slate-700 shadow-inner">
            {user ? <><Cloud size={14} className="text-emerald-400" /> Cloud Sync Activo</> : <><CloudOff size={14} className="text-rose-400" /> Modo Offline</>}
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Panel Lateral de Controles e Historial */}
          <aside className="lg:col-span-4 space-y-6">
            <section className="bg-slate-800/40 rounded-3xl p-6 border border-slate-700/50 backdrop-blur-sm shadow-xl">
              <div className="flex items-center gap-2 mb-6 text-blue-400 border-b border-slate-700/50 pb-3">
                <Settings size={18} />
                <h2 className="font-bold uppercase text-[10px] tracking-[0.2em]">Configuración Técnica</h2>
              </div>
              
              <div className="space-y-6">
                {/* Inputs de Longitud de Tramo */}
                <div className="bg-blue-600/5 p-4 rounded-2xl border border-blue-500/20 space-y-3">
                  <div className="flex items-center gap-2 text-blue-300">
                    <Ruler size={14} />
                    <span className="text-[10px] font-black uppercase tracking-wider">Tramo de Longitud (m)</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input type="text" value={params.L_start} onChange={(e) => handleParamChange('L_start', e.target.value)} className="w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white outline-none focus:border-blue-500" />
                    <input type="text" value={params.L_end} onChange={(e) => handleParamChange('L_end', e.target.value)} className="w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white outline-none focus:border-blue-500" />
                  </div>
                  <div className="flex justify-between items-center text-[10px] font-bold border-t border-blue-500/10 pt-2">
                    <span className="text-slate-400">Total Efectivo:</span>
                    <span className="text-blue-400 font-mono">{effectiveLength.toFixed(3)} m</span>
                  </div>
                </div>

                {/* Sliders Geométricos */}
                {['A', 'B', 'C', 'D', 'E'].map(k => (
                  <div key={k} className="space-y-2">
                    <div className="flex justify-between text-[11px] font-bold">
                      <span className="text-slate-400">Parámetro {k}</span>
                      <span className="text-blue-400 font-mono">{params[k]}<span className="text-[9px] text-slate-600 ml-0.5">mm</span></span>
                    </div>
                    <input 
                      type="range" min="0" max="250" step="1" 
                      value={numericParams[k]} 
                      onChange={(e) => handleParamChange(k, e.target.value)} 
                      className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500 transition-all" 
                    />
                  </div>
                ))}

                {/* Input de Densidad */}
                <div className="pt-2">
                  <label className="text-[9px] text-slate-500 uppercase block mb-1.5 ml-1">Densidad Fluido (kg/m³)</label>
                  <input 
                    type="text" value={params.rho} onChange={(e) => handleParamChange('rho', e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-xs font-mono text-emerald-400 focus:border-emerald-500 outline-none"
                  />
                </div>
              </div>

              <button 
                onClick={() => setIsNaming(true)} 
                className="w-full mt-8 flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-blue-900/20 active:scale-[0.98] transition-all tracking-widest text-xs"
              >
                <Save size={18} /> GUARDAR EN CLOUD
              </button>
            </section>

            {/* Listado de Historial en la Nube */}
            <section className="bg-slate-800/40 rounded-3xl p-6 border border-slate-700/50 backdrop-blur-sm shadow-xl">
              <div className="flex items-center gap-2 mb-4 text-amber-400 border-b border-slate-700/50 pb-3">
                <History size={18} />
                <h2 className="font-bold uppercase text-[10px] tracking-[0.2em]">Historial Cloud</h2>
              </div>
              <div className="space-y-3 max-h-72 overflow-y-auto pr-2 custom-scrollbar">
                {history.map((item) => (
                  <div 
                    key={item.id} 
                    onClick={() => setParams(item.params)} 
                    className="bg-slate-900/40 hover:bg-slate-800 border border-slate-700/50 p-3.5 rounded-2xl cursor-pointer group transition-all"
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex-1">
                        <div className="text-xs font-bold text-slate-200 group-hover:text-blue-400 transition-colors">{item.name}</div>
                        <div className="text-[9px] text-slate-500 font-mono mt-0.5">{item.timestamp} • {item.area} mm²</div>
                      </div>
                      <button onClick={(e) => deleteProfile(item.id, e)} className="p-2 text-slate-600 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all">
                        <Trash2 size={14}/>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </aside>

          {/* Área Principal de Visualización y Métricas */}
          <main className="lg:col-span-8 space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Área Sección', val: analysis.area.toFixed(1), unit: 'mm²', color: 'text-blue-400' },
                { label: 'Radio Hid.', val: analysis.rh.toFixed(2), unit: 'mm', color: 'text-cyan-400' },
                { label: 'Vol. Líquido', val: (analysis.volMm3/1000).toFixed(0), unit: 'cm³', color: 'text-emerald-400' },
                { label: 'Masa Total', val: analysis.massKg.toFixed(3), unit: 'kg', color: 'text-rose-400' },
              ].map((m, i) => (
                <div key={i} className="p-5 rounded-3xl border border-slate-700/50 bg-slate-800/30 backdrop-blur-sm">
                  <span className="text-[9px] font-black uppercase text-slate-500 tracking-wider block mb-2">{m.label}</span>
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-2xl font-black font-mono tracking-tighter ${m.color}`}>{m.val}</span>
                    <span className="text-[10px] text-slate-500 font-bold uppercase">{m.unit}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Visualizador SVG */}
            <div className="bg-slate-900/60 rounded-[2.5rem] p-10 border border-slate-700 shadow-2xl relative overflow-hidden group">
              <div className="absolute top-6 right-6 p-2 bg-slate-800 rounded-lg text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity">
                <Maximize2 size={16} />
              </div>
              
              <div className="aspect-video w-full flex items-center justify-center bg-[#0a0f1d] rounded-[2rem] border border-slate-800/50 shadow-inner p-4">
                <svg 
                  viewBox={`-50 -50 ${numericParams.A + 100} ${Math.max(numericParams.B, numericParams.C, numericParams.D) + 120}`} 
                  className="w-full h-full drop-shadow-2xl" 
                  style={{ transform: 'scaleY(-1)' }} // Invertimos el eje Y para que (0,0) sea la base
                >
                  <defs>
                    <pattern id="grid-cloud" width="20" height="20" patternUnits="userSpaceOnUse">
                      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1e293b" strokeWidth="0.5"/>
                    </pattern>
                  </defs>
                  <rect x="-100" y="-100" width="1000" height="1000" fill="url(#grid-cloud)" />
                  
                  {/* Dibujo del Perfil */}
                  <polygon 
                    points={analysis.points.map(p => p.join(',')).join(' ')} 
                    fill="rgba(59, 130, 246, 0.2)" 
                    stroke="#3b82f6" 
                    strokeWidth="2" 
                    strokeLinejoin="round"
                  />
                  
                  {/* Cotas y Etiquetas */}
                  {renderDimensions()}
                  
                  {/* Punto del Centroide */}
                  <circle cx={analysis.cx} cy={analysis.cy} r="2.5" fill="#f43f5e" />
                </svg>
              </div>
            </div>

            {/* Nota Informativa */}
            <div className="bg-blue-600/5 border border-blue-500/10 rounded-2xl p-4 flex gap-4 items-center">
              <div className="bg-blue-500/10 p-2 rounded-lg">
                <Info className="text-blue-400" size={18} />
              </div>
              <div className="text-[10px] text-slate-400 leading-relaxed font-medium">
                Esta aplicación utiliza <span className="text-slate-200">Firebase Firestore</span> para sincronizar tus perfiles en tiempo real. Los cálculos se basan en geometría pura sobre la sección transversal proyectada.
              </div>
            </div>
          </main>
        </div>
      </div>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; } 
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 20px; }
      `}</style>
    </div>
  );
};

export default App;