import React, { useState, useEffect, useCallback, useRef } from 'react';

const DAY_LABELS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳'];
const DAY_NAMES  = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];

const BELL_TYPES = [
  { value: 'lesson_start', label: 'תחילת שיעור', icon: '📚', color: 'blue' },
  { value: 'break_start',  label: 'תחילת הפסקה', icon: '☕', color: 'amber' },
  { value: 'day_start',    label: 'כניסה / פתיחה', icon: '🌅', color: 'emerald' },
  { value: 'day_end',      label: 'יציאה / סיום',  icon: '🌇', color: 'violet' },
  { value: 'custom',       label: 'כללי',           icon: '🔔', color: 'slate' },
];

const BREAK_PRESETS = [
  { label: 'קטנה',    minutes: 10 },
  { label: 'בינונית', minutes: 15 },
  { label: 'גדולה',   minutes: 20 },
  { label: 'ידני',    minutes: null },
];

const getBellTypeInfo = v => BELL_TYPES.find(t => t.value === v) || BELL_TYPES[4];

const timeToMinutes = t => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

const minutesToTime = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;

const computeCurrentStatus = (bells) => {
  const now = new Date();
  const todayDay = now.getDay().toString();
  const nowMin   = now.getHours() * 60 + now.getMinutes();

  const todayBells = bells
    .filter(b => b.is_active && (b.days||'0,1,2,3,4,5').split(',').includes(todayDay))
    .sort((a, b) => a.time.localeCompare(b.time));

  const passed   = todayBells.filter(b => timeToMinutes(b.time) <= nowMin);
  const upcoming = todayBells.filter(b => timeToMinutes(b.time) >  nowMin);

  const lastBell = passed[passed.length - 1] || null;
  const nextBell = upcoming[0] || null;

  let state = 'before_school';
  if (lastBell) {
    const t = lastBell.bell_type || 'custom';
    if (t === 'break_start') state = 'break';
    else if (t === 'day_end') state = 'after_school';
    else state = 'lesson';
  }

  let minutesUntilNext = nextBell ? timeToMinutes(nextBell.time) - nowMin : null;
  let breakEndsAt = null;
  if (state === 'break') {
    if (lastBell?.break_duration > 0) {
      breakEndsAt = minutesToTime(timeToMinutes(lastBell.time) + lastBell.break_duration);
    } else if (nextBell?.bell_type === 'lesson_start') {
      breakEndsAt = nextBell.time;
    }
  }

  return { state, lastBell, nextBell, minutesUntilNext, breakEndsAt, todayBells, nowMin };
};

const api = async (path, options = {}) => {
  const res = await fetch(path, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'שגיאת שרת' }));
    throw new Error(err.error || 'שגיאה');
  }
  return res.json().catch(() => { throw new Error('שגיאת שרת – תשובה לא תקינה'); });
};

const notify = (msg, type = 'success') => {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = `position:fixed;top:24px;left:50%;transform:translateX(-50%);background:${type==='error'?'#ef4444':'#22c55e'};color:white;padding:14px 28px;border-radius:24px;font-weight:900;z-index:9999;box-shadow:0 8px 30px rgba(0,0,0,.15);direction:rtl;font-size:15px;`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
};

const Toggle = ({ checked, onChange }) => (
  <button onClick={() => onChange(!checked)} className={`relative w-14 h-7 rounded-full transition-all flex-shrink-0 ${checked?'bg-blue-600':'bg-slate-200'}`}>
    <span className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-md transition-all ${checked?'right-1':'right-8'}`}/>
  </button>
);

const DaySelector = ({ value, onChange }) => {
  const days = value ? value.split(',') : [];
  const toggle = d => {
    const next = days.includes(d) ? days.filter(x=>x!==d) : [...days,d].sort();
    onChange(next.join(','));
  };
  return (
    <div className="flex gap-2 flex-wrap">
      {DAY_LABELS.map((label,i) => (
        <button key={i} type="button" onClick={()=>toggle(i.toString())}
          className={`w-11 h-11 rounded-2xl font-bold transition-all text-sm ${days.includes(i.toString())?'bg-blue-600 text-white shadow-lg shadow-blue-100':'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>
          {label}
        </button>
      ))}
    </div>
  );
};

const Modal = ({ onClose, children, wide }) => (
  <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end md:items-center justify-center p-0 md:p-6" onClick={onClose}>
    <div className={`bg-white w-full ${wide?'md:max-w-2xl':'md:max-w-xl'} rounded-t-[32px] md:rounded-[44px] p-7 md:p-12 text-right max-h-[92vh] overflow-y-auto`} onClick={e=>e.stopPropagation()}>
      {children}
    </div>
  </div>
);

export default function App() {
  const [tab, setTab]               = useState('dashboard');
  const [data, setData]             = useState({ bells:[], vacations:[], settings:{}, time:'--:--:--', todayBlocked:false });
  const [devices, setDevices]       = useState(['default']);
  const [playlists, setPlaylists]   = useState([]);
  const [emergency, setEmergency]   = useState([]);
  const [emergencyLog, setEmergencyLog] = useState([]);
  const [typeDefaults, setTypeDefaults] = useState({});
  const [playerStatus, setPlayerStatus] = useState({ playing:false, currentSong:null, songIndex:0, totalSongs:0 });
  const [emergencyActive, setEmergencyActive] = useState(false);
  const [announceActive, setAnnounceActive]   = useState(false);
  const [tunnelInfo, setTunnelInfo] = useState({ url: null, status: 'connecting' });

  // Dashboard view mode
  const [dashView, setDashView]     = useState('status');
  // Bell test state
  const [testingBellId, setTestingBellId] = useState(null);

  // Schedule view: filter by day
  const [filterDay, setFilterDay]   = useState(null); // null = all

  // Modals
  const [showAddBell, setShowAddBell]           = useState(false);
  const [showImportSchedule, setShowImportSchedule] = useState(false);
  const [editBell, setEditBell]                 = useState(null);
  const [showVacation, setShowVacation]         = useState(false);
  const [showHolidays, setShowHolidays]         = useState(false);
  const [showImportFile, setShowImportFile]     = useState(false);
  const [showCopyDay, setShowCopyDay]           = useState(false);
  const [showAddPlaylist, setShowAddPlaylist]   = useState(false);
  const [editPlaylist, setEditPlaylist]         = useState(null);
  const [expandedPlaylist, setExpandedPlaylist] = useState(null);
  const [showAddSong, setShowAddSong]           = useState(null);
  const [showAddEmergency, setShowAddEmergency] = useState(false);
  const [showAnnounce, setShowAnnounce]         = useState(false);
  const [showEmergencyPanel, setShowEmergencyPanel] = useState(false);
  const [showScheduledPlay, setShowScheduledPlay] = useState(false);
  const [showFolderImport, setShowFolderImport]   = useState(null);
  const [showICalImport, setShowICalImport]       = useState(false);
  const [showDayOverride, setShowDayOverride]     = useState(false);
  const [bellLog, setBellLog]                     = useState([]);
  const [dayOverrides, setDayOverrides]           = useState([]);
  const [mobileFullMode, setMobileFullMode]       = useState(() => localStorage.getItem('mobileFullMode') === 'true');
  const [isMobile, setIsMobile]                   = useState(() => window.innerWidth < 768);
  const [showAssignPlaylist, setShowAssignPlaylist] = useState(null);
  const [testingSongId, setTestingSongId]         = useState(null); // { pid, sid }
  const [expandedSongId, setExpandedSongId]       = useState(null); // { pid, sid }
  const [silentMode, setSilentMode]               = useState({ active: false, minutesLeft: 0 });
  const [showSilentModal, setShowSilentModal]     = useState(false);
  const [showCheckFiles, setShowCheckFiles]       = useState(false);
  const [fileCheckResults, setFileCheckResults]   = useState(null);
  const [showTemplates, setShowTemplates]         = useState(false);
  const [templates, setTemplates]                 = useState([]);
  const [pikudEnabled, setPikudEnabled]           = useState(false);
  const [pikudStatus,  setPikudStatus]            = useState({});
  const [editingCell, setEditingCell]             = useState(null);
  const [editingValue, setEditingValue]           = useState('');
  const [sounds, setSounds]                       = useState([]);
  const [bellPresets, setBellPresets]             = useState({});
  const [hebrewInfo, setHebrewInfo]               = useState(null);
  const [upcomingHolidays, setUpcomingHolidays]   = useState([]);
  const [templateRules, setTemplateRules]         = useState([]);
  const [showPDFImport, setShowPDFImport]         = useState(false);
  const [showVacPDF, setShowVacPDF]               = useState(false);
  const [showRemoteAccess, setShowRemoteAccess]   = useState(false);
  const [scheduledPlays, setScheduledPlays]       = useState([]);

  const fetchData           = useCallback(async () => { try { const d = await api('/api/data'); setData(d); } catch {} }, []);
  const fetchPlaylists      = useCallback(async () => { try { const d = await api('/api/playlists'); setPlaylists(d.playlists||[]); } catch {} }, []);
  const fetchEmergency      = useCallback(async () => { try { const d = await api('/api/emergency'); setEmergency(d.files||[]); } catch {} }, []);
  const fetchLog            = useCallback(async () => { try { const d = await api('/api/log'); setBellLog(d.log||[]); } catch {} }, []);
  const fetchDayOverrides   = useCallback(async () => { try { const d = await api('/api/day-overrides'); setDayOverrides(d.overrides||[]); } catch {} }, []);
  const fetchTemplates      = useCallback(async () => { try { const d = await api('/api/templates'); setTemplates(d.templates||[]); } catch {} }, []);
  const fetchPikud          = useCallback(async () => { try { const d = await api('/api/pikud/status'); setPikudEnabled(d.enabled); setPikudStatus(d); } catch {} }, []);
  const fetchSounds         = useCallback(async () => { try { const d = await api('/api/sounds'); setSounds(d||[]); } catch {} }, []);
  const fetchBellPresets    = useCallback(async () => { try { const d = await api('/api/bell-presets'); setBellPresets(d||{}); } catch {} }, []);
  const fetchHebrewInfo     = useCallback(async () => { try { const d = await api('/api/hebrew/today'); setHebrewInfo(d); } catch {} }, []);
  const fetchUpcomingHols   = useCallback(async () => { try { const d = await api('/api/hebrew/upcoming'); setUpcomingHolidays(d.holidays||[]); } catch {} }, []);
  const fetchTemplateRules  = useCallback(async () => { try { const d = await api('/api/template-rules'); setTemplateRules(d||[]); } catch {} }, []);
  const fetchScheduledPlays = useCallback(async () => { try { const d = await api('/api/scheduled-play'); setScheduledPlays(d.plays||[]); } catch {} }, []);
  const fetchEmergencyLog   = useCallback(async () => { try { const d = await api('/api/emergency/log'); setEmergencyLog(d.log||[]); } catch {} }, []);
  const fetchTypeDefaults   = useCallback(async () => { try { const d = await api('/api/type-defaults'); setTypeDefaults(d||{}); } catch {} }, []);

  useEffect(() => {
    fetchData(); fetchPlaylists(); fetchEmergency(); fetchLog(); fetchDayOverrides(); fetchTemplates(); fetchPikud(); fetchSounds();
    fetchBellPresets(); fetchHebrewInfo(); fetchUpcomingHols(); fetchTemplateRules(); fetchScheduledPlays(); fetchEmergencyLog(); fetchTypeDefaults();
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    api('/api/audio-devices').then(d=>setDevices(d.devices)).catch(()=>{});
    api('/api/tunnel/status').then(setTunnelInfo).catch(()=>{});

    const iv1 = setInterval(fetchData, 1000);
    const iv2 = setInterval(async () => {
      try { const s = await api('/api/player/status'); setPlayerStatus(s); } catch {}
    }, 2000);
    const iv3 = setInterval(async () => {
      try {
        const [ann, emg] = await Promise.all([api('/api/announce/status'), api('/api/emergency/status')]);
        setAnnounceActive(ann.active); setEmergencyActive(emg.active);
      } catch {}
    }, 2000);
    const iv4 = setInterval(async () => {
      try { const t = await api('/api/tunnel/status'); setTunnelInfo(t); } catch {}
    }, 6000);
    const iv5 = setInterval(async () => {
      try { const s = await api('/api/silent'); setSilentMode(s); } catch {}
    }, 5000);
    const iv6 = setInterval(async () => {
      try { const d = await api('/api/pikud/status'); setPikudEnabled(d.enabled); setPikudStatus(d); } catch {}
    }, 8000);
    api('/api/silent').then(setSilentMode).catch(()=>{});
    return () => { clearInterval(iv1); clearInterval(iv2); clearInterval(iv3); clearInterval(iv4); clearInterval(iv5); clearInterval(iv6); window.removeEventListener('resize', handleResize); };
  }, [fetchData, fetchPlaylists, fetchEmergency, fetchLog, fetchDayOverrides, fetchTemplates, fetchPikud, fetchSounds, fetchBellPresets, fetchHebrewInfo, fetchUpcomingHols, fetchTemplateRules, fetchScheduledPlays, fetchEmergencyLog, fetchTypeDefaults]);

  // Refresh emergency log when entering the emergency tab
  useEffect(() => { if (tab === 'emergency') fetchEmergencyLog(); }, [tab, fetchEmergencyLog]);

  // Auto-reset test indicators when nothing is playing
  useEffect(() => {
    if (!playerStatus.playing && !playerStatus.process_active) {
      setTestingBellId(null);
      setTestingSongId(null);
    }
  }, [playerStatus.playing, playerStatus.process_active]);

  const doAction = async (fn, refresh) => {
    try { await fn(); if(refresh) await refresh(); else await fetchData(); }
    catch(e) { notify(e.message,'error'); }
  };

  const navItems = [
    { id:'dashboard', icon:'📊', label:'בקרה'    },
    { id:'schedule',  icon:'⏰', label:'צלצולים' },
    { id:'playlists', icon:'🎵', label:'מנגינות'  },
    { id:'vacations', icon:'📅', label:'חופשות'  },
    { id:'log',       icon:'📋', label:'לוג'      },
    { id:'settings',  icon:'⚙️',  label:'הגדרות'  },
  ];

  const schoolName    = data.settings.school_name    || 'בית הספר';
  const principalName = data.settings.principal_name || 'המנהל';

  // Bells filtered by day
  const filteredBells = filterDay === null
    ? data.bells
    : data.bells.filter(b => (b.days||'0,1,2,3,4,5').split(',').includes(filterDay.toString()));


  return (
    <div dir="rtl" className="flex flex-col md:flex-row h-screen bg-[#F7F9FB] text-slate-800 font-sans overflow-hidden">

      {/* SIDEBAR */}
      <aside className="hidden md:flex w-72 bg-white shadow-2xl p-8 flex-col border-l border-slate-100 flex-shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none"><circle cx="14" cy="14" r="14" fill="#2563eb"/><path d="M14 5C10.7 5 8 7.7 8 11v5l-1.5 2h15L20 16v-5c0-3.3-2.7-6-6-6z" fill="white"/><circle cx="14" cy="23" r="2" fill="white"/><rect x="11" y="21" width="6" height="2" rx="1" fill="white"/></svg>
          <span className="text-xl font-black text-blue-600 tracking-tighter">צלצולי</span>
        </div>
        <div className="text-[9px] text-slate-400 font-black mb-2 tracking-wider uppercase">מערכת צלצולים חכמה</div>
        <div className="text-[10px] text-slate-400 font-bold mb-1">{schoolName}</div>
        <div className="text-xs text-slate-300 font-bold mb-4">{principalName}</div>

        {/* Tunnel status pill */}
        <div className={`mb-5 px-3 py-2 rounded-xl flex items-center gap-2 text-xs font-bold ${tunnelInfo.status==='connected'?'bg-emerald-50 text-emerald-700':tunnelInfo.status==='connecting'||tunnelInfo.status==='reconnecting'?'bg-amber-50 text-amber-600':'bg-slate-50 text-slate-400'}`}>
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${tunnelInfo.status==='connected'?'bg-emerald-500 animate-pulse':tunnelInfo.status==='connecting'||tunnelInfo.status==='reconnecting'?'bg-amber-400 animate-pulse':'bg-slate-300'}`}/>
          {tunnelInfo.status==='connected' ? '🌐 גישה מרחוק פעילה' :
           tunnelInfo.status==='connecting'||tunnelInfo.status==='reconnecting' ? 'מתחבר...' :
           tunnelInfo.status==='unavailable' ? 'מנהרה לא זמינה' : 'ללא חיבור מרחוק'}
        </div>

        {data.todayBlocked && (
          <div className="mb-5 bg-amber-50 border border-amber-100 rounded-2xl p-4 text-center">
            <div className="text-xl mb-1">🕯️</div>
            <div className="text-xs font-black text-amber-700">מצב שבת פעיל</div>
          </div>
        )}

        <nav className="space-y-2 flex-1">
          {navItems.map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)}
              className={`w-full text-right px-5 py-4 rounded-2xl font-bold transition-all text-sm ${tab===t.id?'bg-blue-600 text-white shadow-xl shadow-blue-200':'text-slate-400 hover:bg-slate-50'}`}>
              {t.icon} {t.label}
            </button>
          ))}
          <button onClick={()=>setTab('emergency')}
            className={`w-full text-right px-5 py-4 rounded-2xl font-bold transition-all text-sm ${tab==='emergency'?'bg-rose-600 text-white shadow-xl shadow-rose-200':'text-rose-500 hover:bg-rose-50'}`}>
            🚨 חירום
          </button>
        </nav>

        <div className="space-y-3 mt-4">
          {playerStatus.playing && (
            <div className="bg-blue-50 rounded-2xl p-3 text-xs">
              <div className="font-black text-blue-700 mb-1">🎵 מנגן</div>
              <div className="text-blue-600 truncate">{playerStatus.currentSong}</div>
              <div className="text-blue-400 mt-1">{playerStatus.songIndex+1}/{playerStatus.totalSongs}</div>
              <button onClick={()=>doAction(()=>api('/api/player/stop',{method:'POST'}).then(()=>notify('הופסק')))}
                className="mt-2 w-full bg-blue-600 text-white py-1.5 rounded-xl text-xs font-bold">⏹ עצור</button>
            </div>
          )}
          <button onClick={()=>setShowSilentModal(true)}
            className={`w-full py-3 rounded-2xl font-black text-sm transition ${silentMode.active?'bg-slate-800 text-white animate-pulse':'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {silentMode.active ? `🔇 שקט – ${silentMode.minutesLeft} דק׳ נותרו` : '🔇 השתק'}
          </button>
          <button onClick={()=>isMobile ? window.location.href='/announce' : setShowAnnounce(true)}
            className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black text-base hover:bg-blue-700 transition shadow-lg shadow-blue-100">
            📢 כריזה
          </button>
          {!isMobile && (
            <button onClick={()=>setShowRemoteAccess(true)}
              className="w-full bg-slate-100 text-slate-600 py-2.5 rounded-2xl font-bold text-sm hover:bg-slate-200 transition">
              🌐 גישה מרחוק
            </button>
          )}
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex-1 overflow-y-auto pb-24 md:pb-0 p-5 md:p-14">

        <header className="flex justify-between items-center mb-8 md:mb-14">
          <div>
            <h1 className="text-2xl md:text-4xl font-black text-slate-900 tracking-tight">
              {tab==='dashboard' ? `שלום, ${principalName}` :
               tab==='schedule'  ? 'ניהול צלצולים' :
               tab==='playlists' ? 'מנגינות וקבצי שמע' :
               tab==='vacations' ? 'לוח חופשות' :
               tab==='emergency' ? 'הודעות חירום' :
               tab==='log'       ? 'יומן פעילות' : 'הגדרות'}
            </h1>
            <p className="text-slate-400 text-sm font-medium mt-1">{schoolName}</p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {(playerStatus.playing || testingBellId !== null || announceActive) && (
              <button
                onClick={()=>doAction(()=>api('/api/player/stop',{method:'POST'}).then(()=>{setTestingBellId(null);notify('⏹ הופסק')}))}
                className="bg-rose-600 text-white px-5 py-3 rounded-2xl font-black text-sm hover:bg-rose-700 transition shadow-lg shadow-rose-100 animate-pulse flex items-center gap-2">
                ⏹ עצור
              </button>
            )}
            <div className="bg-white px-5 md:px-8 py-3 md:py-5 rounded-[24px] shadow-sm border border-slate-100 text-center">
              <span className="text-[10px] font-black text-blue-600 block uppercase mb-1">זמן שרת</span>
              <span className="text-2xl md:text-3xl font-black tabular-nums">{data.time}</span>
            </div>
          </div>
        </header>

        {/* DASHBOARD */}
        {tab==='dashboard' && (() => {
          const status = computeCurrentStatus(data.bells);
          const stateLabel = {
            before_school: { text: 'לפני תחילת הלימודים', color: 'slate',   icon: '🌅' },
            lesson:        { text: 'בשיעור',               color: 'blue',    icon: '📚' },
            break:         { text: 'הפסקה',                color: 'amber',   icon: '☕' },
            after_school:  { text: 'סיום הלימודים',        color: 'violet',  icon: '🌇' },
          }[status.state] || { text: '—', color: 'slate', icon: '🔔' };

          const colorMap = {
            blue:   { bg:'bg-blue-600',   soft:'bg-blue-50',   text:'text-blue-700',   border:'border-blue-100' },
            amber:  { bg:'bg-amber-500',  soft:'bg-amber-50',  text:'text-amber-700',  border:'border-amber-100' },
            slate:  { bg:'bg-slate-600',  soft:'bg-slate-50',  text:'text-slate-700',  border:'border-slate-100' },
            violet: { bg:'bg-violet-600', soft:'bg-violet-50', text:'text-violet-700', border:'border-violet-100' },
            emerald:{ bg:'bg-emerald-600',soft:'bg-emerald-50',text:'text-emerald-700',border:'border-emerald-100' },
          };
          const c = colorMap[stateLabel.color] || colorMap.slate;

          return (
          <div className="space-y-6">
            {/* View tabs */}
            <div className="flex gap-2 bg-slate-100 p-1.5 rounded-2xl w-fit">
              {[['status','📍 עכשיו'],['today','📅 היום'],['weekly','🗓 שבועי'],['monthly','📆 חודשי']].map(([v,l])=>(
                <button key={v} onClick={()=>setDashView(v)}
                  className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all ${dashView===v?'bg-white shadow-sm text-slate-800':'text-slate-400 hover:text-slate-600'}`}>
                  {l}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-8">
              {/* Main panel */}
              <div className="md:col-span-8">

                {/* STATUS VIEW */}
                {dashView==='status' && (
                  <div className="space-y-4">
                    <div className={`${c.bg} rounded-[32px] p-8 text-white shadow-2xl`}>
                      <div className="text-5xl mb-4">{stateLabel.icon}</div>
                      <div className="text-3xl font-black mb-2">{stateLabel.text}</div>
                      {status.lastBell && (
                        <div className="opacity-80 text-sm font-bold mb-1">
                          {status.state==='break' && status.breakEndsAt
                            ? `הפסקה עד ${status.breakEndsAt}`
                            : `מאז ${status.lastBell.time} — ${status.lastBell.label}`}
                        </div>
                      )}
                      {status.nextBell && (
                        <div className="mt-4 bg-white/20 rounded-2xl p-4">
                          <div className="text-xs font-black opacity-80 mb-1">הצלצול הבא</div>
                          <div className="text-2xl font-black">{status.nextBell.time}</div>
                          <div className="font-bold opacity-90">{status.nextBell.label}</div>
                          <div className="text-xs opacity-70 mt-1">
                            בעוד {status.minutesUntilNext >= 60
                              ? `${Math.floor(status.minutesUntilNext/60)}ש׳ ${status.minutesUntilNext%60}ד׳`
                              : `${status.minutesUntilNext} דקות`}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Countdown strip */}
                    {status.nextBell && (
                      <div className="bg-white rounded-[28px] p-6 shadow-sm border border-slate-100 flex items-center gap-5">
                        <div className={`text-4xl font-black tabular-nums ${c.text}`}>
                          {status.minutesUntilNext >= 60
                            ? `${Math.floor(status.minutesUntilNext/60)}:${String(status.minutesUntilNext%60).padStart(2,'0')}`
                            : `${status.minutesUntilNext}′`}
                        </div>
                        <div>
                          <div className="text-slate-400 text-xs font-bold">עד הצלצול הבא</div>
                          <div className="font-black text-slate-700">{status.nextBell.label}</div>
                          <div className="text-slate-400 text-sm">{status.nextBell.time}</div>
                        </div>
                      </div>
                    )}

                    {/* Quick action buttons — visible on all screen sizes */}
                    <div className="grid grid-cols-2 gap-3">
                      <button onClick={()=>setShowAnnounce(true)}
                        className="bg-blue-600 text-white py-5 rounded-[24px] font-black text-sm shadow-xl shadow-blue-100 hover:bg-blue-700 active:scale-95 transition flex flex-col items-center gap-2">
                        <span className="text-3xl">📢</span>
                        כריזה חיה
                      </button>
                      <button onClick={()=>setShowScheduledPlay(true)}
                        className="bg-emerald-600 text-white py-5 rounded-[24px] font-black text-sm shadow-xl shadow-emerald-100 hover:bg-emerald-700 active:scale-95 transition flex flex-col items-center gap-2">
                        <span className="text-3xl">💬</span>
                        השאר הודעה
                      </button>
                    </div>
                  </div>
                )}

                {/* TODAY VIEW */}
                {dashView==='today' && (
                  <div className="bg-white rounded-[32px] shadow-sm border border-slate-100 overflow-hidden">
                    <div className="p-6 border-b border-slate-100">
                      <h2 className="font-black text-lg">מערכת יום {DAY_NAMES[new Date().getDay()] || ''}</h2>
                      <p className="text-slate-400 text-sm mt-0.5">{status.todayBells.length} צלצולים היום</p>
                      {status.todayBells.length > 0 && (() => {
                        const first = timeToMinutes(status.todayBells[0].time);
                        const last  = timeToMinutes(status.todayBells[status.todayBells.length-1].time);
                        const pct   = last > first ? Math.min(100, Math.max(0, ((status.nowMin - first) / (last - first)) * 100)) : 0;
                        return (
                          <div className="mt-3 bg-slate-100 rounded-full h-1.5 relative overflow-hidden">
                            <div className="absolute top-0 right-0 h-full bg-blue-500 rounded-full transition-all" style={{width:`${pct}%`}}/>
                          </div>
                        );
                      })()}
                    </div>
                    {status.todayBells.length===0 ? (
                      <div className="text-center py-16 text-slate-300"><div className="text-5xl mb-2">🔕</div><div className="font-bold">אין צלצולים היום</div></div>
                    ) : (
                      <div className="divide-y divide-slate-50">
                        {status.todayBells.map((b, i) => {
                          const bMin    = timeToMinutes(b.time);
                          const isPast  = bMin <= status.nowMin;
                          const isCur   = status.lastBell?.id === b.id;
                          const isNext  = status.nextBell?.id === b.id;
                          const ti      = getBellTypeInfo(b.bell_type);
                          return (
                            <div key={b.id} className={`flex items-center gap-4 px-6 py-4 transition ${isCur?'bg-amber-50':isNext?'bg-blue-50':isPast?'opacity-40':''}`}>
                              <div className={`w-1.5 h-10 rounded-full flex-shrink-0 ${isCur?'bg-amber-400':isNext?'bg-blue-500 animate-pulse':isPast?'bg-slate-200':'bg-slate-100'}`}/>
                              <span className="text-xl">{ti.icon}</span>
                              <div className="flex-1 min-w-0">
                                <div className={`font-black ${isCur?'text-amber-700':isNext?'text-blue-700':isPast?'text-slate-400':'text-slate-700'}`}>{b.label}</div>
                                {b.bell_type==='break_start' && b.break_duration>0 && (
                                  <div className="text-xs text-amber-500 font-bold">הפסקה {b.break_duration} דק׳</div>
                                )}
                              </div>
                              <div className={`text-xl font-black tabular-nums flex-shrink-0 ${isCur?'text-amber-600':isNext?'text-blue-600':isPast?'text-slate-300':'text-slate-700'}`}>
                                {b.time}
                              </div>
                              {(isCur||isNext) && (
                                <span className={`text-xs font-black px-2 py-1 rounded-lg ${isCur?'bg-amber-100 text-amber-700':'bg-blue-100 text-blue-700'}`}>
                                  {isCur?'עכשיו':'הבא'}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* WEEKLY VIEW */}
                {dashView==='weekly' && (
                  <div className="bg-white rounded-[32px] shadow-sm border border-slate-100 overflow-hidden">
                    <div className="p-5 border-b border-slate-100">
                      <h2 className="font-black text-lg">מערכת שבועית</h2>
                      <p className="text-slate-400 text-xs mt-0.5">כל הצלצולים לפי יום</p>
                    </div>
                    <div className="overflow-x-auto">
                      <div className="grid min-w-[520px]" style={{gridTemplateColumns:`repeat(6,1fr)`}}>
                        {[0,1,2,3,4,5].map(dayIdx => {
                          const dayBells = data.bells
                            .filter(b => b.is_active && (b.days||'0,1,2,3,4,5').split(',').includes(dayIdx.toString()))
                            .sort((a,b)=>a.time.localeCompare(b.time));
                          const isToday = new Date().getDay() === dayIdx;
                          return (
                            <div key={dayIdx} className={`border-l border-slate-100 last:border-l-0 ${isToday?'bg-blue-50':''}`}>
                              <div className={`p-2.5 text-center font-black text-xs border-b border-slate-100 sticky top-0 ${isToday?'bg-blue-600 text-white':'bg-slate-50 text-slate-500'}`}>
                                {DAY_NAMES[dayIdx]}
                              </div>
                              <div className="p-1.5 space-y-1 min-h-[120px]">
                                {dayBells.length===0
                                  ? <div className="text-center py-6 text-slate-200 text-xs">—</div>
                                  : dayBells.map(b=>{
                                      const ti=getBellTypeInfo(b.bell_type);
                                      return (
                                        <div key={b.id} className={`rounded-xl p-1.5 text-xs ${isToday?'bg-white shadow-sm':'bg-slate-50'}`}>
                                          <div className="flex items-center gap-1">
                                            <span>{ti.icon}</span>
                                            <span className="font-black tabular-nums text-blue-600">{b.time}</span>
                                          </div>
                                          <div className="text-slate-600 truncate mt-0.5">{b.label}</div>
                                          {b.bell_type==='break_start'&&b.break_duration>0&&
                                            <div className="text-amber-500 font-bold">{b.break_duration}′</div>}
                                        </div>
                                      );
                                    })
                                }
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* MONTHLY VIEW */}
                {dashView==='monthly' && (
                  <MonthlyCalendar data={data} dayOverrides={dayOverrides} upcomingHolidays={upcomingHolidays} onRefresh={()=>{fetchData();fetchDayOverrides();}} />
                )}
              </div>

              {/* Side panel */}
              <div className="md:col-span-4 space-y-5">
                {(emergencyActive || announceActive) && (
                  <div className={`p-5 rounded-[28px] text-white shadow-xl animate-pulse ${emergencyActive?'bg-rose-600':'bg-blue-600'}`}>
                    <div className="text-center py-1">
                      <div className="text-3xl mb-2">{emergencyActive?'🚨':'📢'}</div>
                      <div className="font-black mb-3">{emergencyActive?'חירום פעיל!':'כריזה פעילה...'}</div>
                      {emergencyActive && (
                        <button onClick={()=>doAction(()=>api('/api/player/stop',{method:'POST'}).then(()=>notify('הופסק')))}
                          className="w-full bg-white/20 hover:bg-white/30 text-white font-black py-2 rounded-2xl text-sm transition">
                          ⏹ עצור עכשיו
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {playerStatus.playing && (
                  <div className="bg-white p-6 rounded-[32px] shadow-sm border border-slate-100">
                    <div className="flex justify-between items-start mb-3">
                      <button onClick={()=>doAction(()=>api('/api/player/stop',{method:'POST'}).then(()=>notify('הופסק')),fetchPlaylists)} className="bg-slate-100 text-slate-600 px-4 py-2 rounded-xl font-bold text-sm hover:bg-slate-200">⏹ עצור</button>
                      <div className="text-sm font-black text-blue-600">🎵 מנגן</div>
                    </div>
                    <div className="text-slate-700 font-bold text-sm truncate">{playerStatus.currentSong}</div>
                    <div className="text-slate-400 text-xs mt-1">שיר {playerStatus.songIndex+1} מתוך {playerStatus.totalSongs}</div>
                    <button onClick={()=>doAction(()=>api('/api/player/next',{method:'POST'}).then(()=>notify('הבא')))} className="mt-3 w-full bg-blue-50 text-blue-600 py-2 rounded-xl font-bold text-sm">⏭ הבא</button>
                  </div>
                )}

                <div className="bg-white p-6 rounded-[32px] shadow-sm border border-slate-100">
                  <h2 className="font-bold text-slate-600 mb-4">סיכום מהיר</h2>
                  {[
                    { label:'צלצולים פעילים',  value: data.bells.filter(b=>b.is_active).length },
                    { label:'חופשות מתוזמנות', value: data.vacations.length },
                    { label:'פלייליסטים',       value: playlists.length },
                    { label:'הודעות חירום',     value: emergency.length },
                  ].map(s => (
                    <div key={s.label} className="flex justify-between items-center mb-2">
                      <span className="text-xl font-black text-blue-600">{s.value}</span>
                      <span className="text-slate-400 text-sm">{s.label}</span>
                    </div>
                  ))}
                </div>

                {/* Scheduled plays panel */}
                {scheduledPlays.length > 0 && (
                  <div className="bg-white p-6 rounded-[32px] shadow-sm border border-slate-100">
                    <div className="flex justify-between items-center mb-4">
                      <h2 className="font-bold text-slate-600">⏰ הודעות מתוזמנות</h2>
                      <button onClick={()=>setShowScheduledPlay(true)} className="bg-blue-50 text-blue-600 px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-blue-100">+ הוסף</button>
                    </div>
                    <div className="space-y-2">
                      {scheduledPlays.map(sp => (
                        <div key={sp.id} className="flex items-center gap-2 bg-slate-50 rounded-2xl px-4 py-2.5">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-bold truncate">{sp.label}</div>
                            <div className="text-xs text-slate-400">{sp.play_at?.replace('T',' ').slice(0,16)}</div>
                          </div>
                          <button onClick={async()=>{
                            await api(`/api/scheduled-play/${sp.id}`,{method:'DELETE'});
                            notify('בוטל'); fetchScheduledPlays();
                          }} className="text-rose-300 hover:text-rose-500 transition flex-shrink-0">✕</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          );
        })()}

        {/* SCHEDULE */}
        {tab==='schedule' && (
          <div className="space-y-6">
            {/* Toolbar */}
            <div className="flex flex-wrap gap-3 justify-between items-center">
              <div className="flex gap-2 flex-wrap">
                <button onClick={()=>setFilterDay(null)}
                  className={`px-4 py-2.5 rounded-2xl font-bold text-sm transition-all ${filterDay===null?'bg-slate-800 text-white':'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}>
                  הכל
                </button>
                {DAY_LABELS.map((label,i) => (
                  <button key={i} onClick={()=>setFilterDay(filterDay===i?null:i)}
                    className={`px-4 py-2.5 rounded-2xl font-bold text-sm transition-all ${filterDay===i?'bg-blue-600 text-white shadow-lg shadow-blue-100':'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 flex-wrap">
                {filterDay !== null && (
                  <button onClick={()=>setShowCopyDay(true)}
                    className="bg-violet-600 text-white px-5 py-3 rounded-[20px] font-black shadow-lg shadow-violet-100 hover:bg-violet-700 transition text-sm">
                    📋 העתק יום {DAY_NAMES[filterDay]}
                  </button>
                )}
                <button onClick={async()=>{ const r=await api('/api/bells/check-files'); setFileCheckResults(r); setShowCheckFiles(true); }}
                  className="bg-slate-100 text-slate-600 px-5 py-3 rounded-[20px] font-black hover:bg-slate-200 transition text-sm">
                  🔍 בדוק קבצים
                </button>
                <button onClick={async()=>{
                  if(!window.confirm('⚠️ למחוק את כל הצלצולים מהמערכת?\nפעולה זו בלתי הפיכה!')) return;
                  await api('/api/bells',{method:'DELETE'});
                  notify('כל הצלצולים נמחקו'); fetchData();
                }} className="bg-rose-100 text-rose-600 px-5 py-3 rounded-[20px] font-black hover:bg-rose-200 transition text-sm">
                  🗑 נקה הכל
                </button>
                <button onClick={()=>{ fetchTemplates(); setShowTemplates(true); }}
                  className="bg-violet-600 text-white px-5 py-3 rounded-[20px] font-black shadow-lg shadow-violet-100 hover:bg-violet-700 transition text-sm">
                  📋 תבניות
                </button>
                <button onClick={()=>setShowImportSchedule(true)}
                  className="bg-emerald-600 text-white px-5 py-3 rounded-[20px] font-black shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition text-sm">
                  📥 ייבוא מ-PDF / Excel
                </button>
                <button onClick={()=>setShowAddBell(true)}
                  className="bg-blue-600 text-white px-7 py-3 rounded-[20px] font-black shadow-xl shadow-blue-100 hover:bg-blue-700 transition text-sm">
                  + הוסף צלצול
                </button>
              </div>
            </div>

            {filterDay !== null && (
              <div className="bg-violet-50 border border-violet-100 rounded-2xl px-5 py-3 text-sm text-violet-700 font-bold flex items-center gap-2">
                <span>📅</span>
                <span>מציג צלצולים של יום {DAY_NAMES[filterDay]} — {filteredBells.length} צלצולים</span>
                <button onClick={()=>setFilterDay(null)} className="mr-auto text-violet-400 hover:text-violet-600 font-black">✕</button>
              </div>
            )}

            <div className="bg-white rounded-[32px] shadow-sm border border-slate-100 overflow-x-auto">
              {filteredBells.length===0 ? (
                <div className="text-center py-20 text-slate-300">
                  <div className="text-5xl mb-3">🔕</div>
                  <div className="font-bold">{filterDay !== null ? `אין צלצולים ביום ${DAY_NAMES[filterDay]}` : 'אין צלצולים'}</div>
                </div>
              ) : (
                <table className="w-full text-right min-w-[540px]">
                  <thead className="bg-slate-50 border-b">
                    <tr>{['שעה','שם','ימים','פעיל','ניהול'].map(h => (
                      <th key={h} className="p-5 md:p-7 text-slate-400 font-bold text-xs uppercase">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {filteredBells.map(b => {
                      const ti = getBellTypeInfo(b.bell_type);
                      const isTesting = testingBellId === b.id;
                      const isEditTime  = editingCell?.id===b.id && editingCell?.field==='time';
                      const isEditLabel = editingCell?.id===b.id && editingCell?.field==='label';
                      const saveCell = async () => {
                        if (!editingCell) return;
                        const fd = new FormData();
                        Object.entries(b).forEach(([k,v])=>{ if(v!==null&&v!==undefined) fd.append(k,v); });
                        fd.set(editingCell.field, editingValue);
                        await fetch(`/api/bells/${b.id}`,{method:'PUT',body:fd});
                        setEditingCell(null); await fetchData();
                      };
                      return (
                      <tr key={b.id} className="border-b hover:bg-slate-50/50 transition">
                        <td className="p-4 md:p-6">
                          <div className="flex items-center gap-2">
                            <span title={ti.label}>{ti.icon}</span>
                            {isEditTime
                              ? <input type="time" value={editingValue} autoFocus
                                  onChange={e=>setEditingValue(e.target.value)}
                                  onBlur={saveCell} onKeyDown={e=>{if(e.key==='Enter')saveCell();if(e.key==='Escape')setEditingCell(null);}}
                                  className="text-xl font-black text-blue-600 tabular-nums w-28 border-b-2 border-blue-400 bg-transparent focus:outline-none"/>
                              : <span className="text-xl font-black text-blue-600 tabular-nums cursor-pointer select-none"
                                  onDoubleClick={()=>{setEditingCell({id:b.id,field:'time'});setEditingValue(b.time);}}>
                                  {b.time}
                                </span>
                            }
                          </div>
                          {b.bell_type==='break_start' && b.break_duration>0 && (
                            <div className="text-xs text-amber-500 font-bold mt-0.5 mr-6">{b.break_duration} דק׳</div>
                          )}
                        </td>
                        <td className="p-4 md:p-6 font-bold">
                          {isEditLabel
                            ? <input value={editingValue} autoFocus
                                onChange={e=>setEditingValue(e.target.value)}
                                onBlur={saveCell} onKeyDown={e=>{if(e.key==='Enter')saveCell();if(e.key==='Escape')setEditingCell(null);}}
                                className="w-full border-b-2 border-blue-400 bg-transparent font-bold focus:outline-none"/>
                            : <span className="cursor-pointer select-none"
                                onDoubleClick={()=>{setEditingCell({id:b.id,field:'label'});setEditingValue(b.label);}}>
                                {b.label}
                              </span>
                          }
                        </td>
                        <td className="p-4 md:p-6">
                          <div className="flex gap-1 flex-wrap">
                            {(b.days||'0,1,2,3,4,5').split(',').map(d=>(
                              <span key={d} className="bg-blue-50 text-blue-700 text-xs font-bold px-2 py-1 rounded-lg">{DAY_LABELS[parseInt(d)]}</span>
                            ))}
                          </div>
                        </td>
                        <td className="p-4 md:p-6">
                          <Toggle checked={!!b.is_active} onChange={v=>doAction(()=>
                            api(`/api/bells/${b.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...b,is_active:v?1:0})}).then(()=>notify(v?'הופעל':'הושהה'))
                          )}/>
                        </td>
                        <td className="p-4 md:p-6">
                          <div className="flex gap-2 flex-wrap">
                            {isTesting ? (
                              <button onClick={()=>doAction(()=>api('/api/player/stop',{method:'POST'}).then(()=>{setTestingBellId(null);notify('הופסק')}))}
                                className="bg-rose-500 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-rose-600 animate-pulse">⏹ עצור</button>
                            ) : (
                              <button onClick={async()=>{try{await api(`/api/bells/play/${b.id}`,{method:'POST'});setTestingBellId(b.id);notify('מנגן...');}catch(e){notify(e.message,'error');}}}
                                className="bg-blue-50 text-blue-600 px-4 py-2 rounded-xl font-bold text-sm hover:bg-blue-100">▶ בדוק</button>
                            )}
                            <button onClick={()=>setEditBell(b)} className="bg-slate-100 text-slate-600 px-4 py-2 rounded-xl font-bold text-sm hover:bg-slate-200">ערוך</button>
                            <button onClick={()=>doAction(()=>api(`/api/bells/duplicate/${b.id}`,{method:'POST'}).then(()=>notify('שוכפל')))}
                              className="bg-emerald-50 text-emerald-600 px-4 py-2 rounded-xl font-bold text-sm hover:bg-emerald-100">שכפל</button>
                            <button onClick={()=>confirm('למחוק?')&&doAction(()=>api(`/api/bells/${b.id}`,{method:'DELETE'}).then(()=>notify('נמחק')))}
                              className="bg-rose-50 text-rose-600 px-4 py-2 rounded-xl font-bold text-sm hover:bg-rose-100">מחק</button>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* PLAYLISTS */}
        {tab==='playlists' && (
          <div className="space-y-6">
            {/* ===== AUDIO FILES SECTION ===== */}
            <div className="bg-white rounded-[32px] shadow-sm border border-slate-100 overflow-hidden">
              <div className="flex items-center justify-between px-6 pt-6 pb-4">
                <div>
                  <h2 className="font-black text-xl text-slate-800">🎵 קבצי שמע</h2>
                  <p className="text-slate-400 text-sm mt-0.5">כל קבצי הצלצולים המועלים למערכת</p>
                </div>
                <label className="cursor-pointer bg-blue-600 text-white px-5 py-3 rounded-[20px] font-black text-sm hover:bg-blue-700 transition shadow-lg shadow-blue-100">
                  ⬆️ העלה קובץ
                  <input type="file" accept=".mp3,.wav,.ogg,.m4a,.aac" className="hidden" onChange={async e=>{
                    const file = e.target.files[0]; if (!file) return;
                    const fd = new FormData(); fd.append('file', file); fd.append('name', file.name);
                    try {
                      const r = await fetch('/api/sounds/upload',{method:'POST',body:fd});
                      const d = await r.json();
                      if (d.error) notify(d.error,'error'); else { notify(`✅ הועלה: ${d.name}`); fetchSounds(); }
                    } catch { notify('שגיאה בהעלאה','error'); }
                    e.target.value='';
                  }}/>
                </label>
              </div>
              <div className="px-6 pb-6">
                {sounds.length === 0 ? (
                  <div className="text-center text-slate-300 py-10">
                    <div className="text-4xl mb-3">🎵</div>
                    <div className="font-bold">אין קבצי שמע</div>
                    <div className="text-sm mt-1">העלה קבצי MP3/WAV לשימוש בצלצולים</div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sounds.map(s => (
                      <div key={s.name} className="bg-slate-50 rounded-2xl overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-3">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-bold text-slate-700 truncate">{s.name}</div>
                            {s.connectedBells?.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {s.connectedBells.map(b=>(
                                  <span key={b.id} className="text-[10px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-bold">
                                    🔔 {b.label}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          {testingSongId?.pid==='sound' && testingSongId?.sid===s.name ? (
                            <button onClick={()=>doAction(()=>api('/api/player/stop',{method:'POST'}).then(()=>{setTestingSongId(null);notify('הופסק')}))}
                              className="bg-rose-100 text-rose-600 px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-rose-200 animate-pulse">⏹ עצור</button>
                          ) : (
                            <button onClick={async()=>{
                              await api(`/api/sounds/${encodeURIComponent(s.name)}/play`,{method:'POST'});
                              setTestingSongId({pid:'sound',sid:s.name}); notify('▶ מנגן');
                            }} className="bg-slate-200 text-slate-600 px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-blue-100 hover:text-blue-700 transition">▶ נגן</button>
                          )}
                          <button onClick={()=>setExpandedSongId(expandedSongId?.sid===s.name?null:{pid:'sound',sid:s.name})}
                            className={`px-2.5 py-1.5 rounded-xl font-bold text-xs ${expandedSongId?.sid===s.name?'bg-blue-600 text-white':'bg-slate-200 text-slate-500 hover:bg-slate-300'}`}>✂️</button>
                          <button onClick={async()=>{
                            if(!confirm(`למחוק את "${s.name}"?`)) return;
                            const r = await fetch(`/api/sounds/${encodeURIComponent(s.name)}`,{method:'DELETE'});
                            const d = await r.json();
                            if(d.connected) {
                              if(!confirm(`⚠️ הקובץ מחובר ל-${d.connected} צלצול/ים.\nהצלצולים ישארו ללא קובץ שמע.\nלמחוק בכל זאת?`)) return;
                              const r2 = await fetch(`/api/sounds/${encodeURIComponent(s.name)}?force=true`,{method:'DELETE'});
                              const d2 = await r2.json();
                              if(d2.error) notify(d2.error,'error'); else { notify('נמחק'); fetchSounds(); fetchData(); }
                            } else if(d.error) { notify(d.error,'error'); }
                            else { notify('נמחק'); fetchSounds(); }
                          }} className="bg-red-100 text-red-600 px-2.5 py-1.5 rounded-xl text-xs font-bold hover:bg-red-200 transition">🗑</button>
                        </div>
                        {expandedSongId?.sid===s.name && (
                          <div className="border-t border-slate-200 bg-blue-50/50 px-4 py-3">
                            <SongRangeEditor song={{id:s.name, start_time:0, duration:0}}
                              audioUrl={`/uploads/${s.name}`}
                              onSave={async(vals)=>{
                                await api(`/api/sounds/${encodeURIComponent(s.name)}/play`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(vals)});
                                notify('▶ מנגן עם טווח זה');
                              }}/>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ===== TYPE DEFAULTS SECTION ===== */}
            <div className="bg-white rounded-[32px] shadow-sm border border-slate-100 p-6">
              <h2 className="font-black text-xl text-slate-800 mb-1">⚙️ ברירות מחדל לסוגי צלצולים</h2>
              <p className="text-slate-400 text-sm mb-5">הגדר קובץ ברירת מחדל שייבחר אוטומטית בעת יצירת צלצול חדש מכל סוג</p>
              <div className="space-y-3">
                {BELL_TYPES.map(({ value, label, icon }) => (
                  <div key={value} className="flex items-center gap-3">
                    <span className="text-xl w-7 flex-shrink-0">{icon}</span>
                    <span className="w-28 font-bold text-sm text-slate-600 flex-shrink-0">{label}</span>
                    <select
                      value={typeDefaults[value]||''}
                      onChange={async e=>{
                        await api('/api/type-defaults',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:value,audio_source:e.target.value})});
                        fetchTypeDefaults(); notify('✅ נשמר');
                      }}
                      className="flex-1 p-3 bg-slate-50 rounded-2xl border border-slate-200 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">— ללא ברירת מחדל —</option>
                      {sounds.map(s=><option key={s.name} value={s.path}>{s.name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* ===== PLAYLISTS SECTION ===== */}
            <div className="flex items-center justify-between">
              <h2 className="font-black text-xl text-slate-800">📋 פלייליסטים</h2>
              <button onClick={()=>setShowAddPlaylist(true)}
                className="bg-blue-600 text-white px-7 py-4 rounded-[24px] font-black shadow-xl shadow-blue-100 hover:bg-blue-700 transition text-sm">
                + פלייליסט חדש
              </button>
            </div>
            {playlists.length===0 ? (
              <div className="bg-white rounded-[32px] p-16 text-center text-slate-300">
                <div className="text-5xl mb-3">🎵</div><div className="font-bold">אין פלייליסטים</div>
              </div>
            ) : (
              <div className="space-y-4">
                {playlists.map(pl => (
                  <div key={pl.id} className="bg-white rounded-[28px] shadow-sm border border-slate-100 overflow-hidden">
                    <div className="p-5 flex justify-between items-center cursor-pointer hover:bg-slate-50 transition"
                      onClick={()=>setExpandedPlaylist(expandedPlaylist===pl.id?null:pl.id)}>
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">🎵</span>
                        <div>
                          <div className="font-black text-lg">{pl.name}</div>
                          <div className="text-slate-400 text-sm">{pl.songs?.length||0} שירים {pl.shuffle?'· שאפל':''} {pl.repeat_mode?'· חזרה':''}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {playerStatus.playing && playerStatus.playlistId===pl.id ? (
                          <button onClick={e=>{e.stopPropagation();doAction(()=>api('/api/player/stop',{method:'POST'}).then(()=>notify('הופסק')))}}
                            className="bg-rose-100 text-rose-600 px-5 py-2.5 rounded-2xl font-black text-sm">⏹ עצור</button>
                        ) : (
                          <button onClick={e=>{e.stopPropagation();doAction(()=>api(`/api/playlists/${pl.id}/play`,{method:'POST'}).then(()=>notify('מנגן 🎵')))}}
                            className="bg-blue-600 text-white px-5 py-2.5 rounded-2xl font-black text-sm shadow-lg shadow-blue-100">▶ נגן</button>
                        )}
                        <button onClick={e=>{e.stopPropagation();setShowAssignPlaylist(pl.id)}}
                          className="bg-amber-50 text-amber-600 px-4 py-2.5 rounded-2xl font-black text-xs hover:bg-amber-100 transition">🔔 שייך</button>
                        <button onClick={e=>{e.stopPropagation();setEditPlaylist(pl)}} className="bg-slate-100 text-slate-600 w-9 h-9 rounded-xl font-bold text-lg flex items-center justify-center hover:bg-slate-200">✏️</button>
                        <button onClick={e=>{e.stopPropagation();confirm('למחוק?')&&doAction(()=>api(`/api/playlists/${pl.id}`,{method:'DELETE'}).then(()=>notify('נמחק')),fetchPlaylists)}}
                          className="bg-rose-50 text-rose-500 w-9 h-9 rounded-xl font-bold text-lg flex items-center justify-center hover:bg-rose-100">🗑</button>
                        <span className="text-slate-300">{expandedPlaylist===pl.id?'▲':'▼'}</span>
                      </div>
                    </div>
                    {expandedPlaylist===pl.id && (
                      <div className="border-t border-slate-100 p-5 bg-slate-50/50">
                        {pl.songs?.length===0 ? (
                          <div className="text-center py-6 text-slate-300 text-sm">הפלייליסט ריק – הוסף שירים</div>
                        ) : (
                          <div className="space-y-2 mb-4">
                            {pl.songs.map((s,i) => {
                              const isTesting = testingSongId?.pid===pl.id && testingSongId?.sid===s.id;
                              const isExpanded = expandedSongId?.pid===pl.id && expandedSongId?.sid===s.id;
                              return (
                              <div key={s.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                                <div className="flex items-center gap-2 px-4 py-3">
                                  <span className="text-slate-300 font-black text-sm w-5 flex-shrink-0">{i+1}</span>
                                  <span className="font-bold text-sm flex-1 truncate">{s.name}</span>
                                  {/* Reorder */}
                                  <button onClick={async()=>{ await api(`/api/playlists/${pl.id}/songs/${s.id}/move`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({direction:'up'})}); fetchPlaylists(); }}
                                    disabled={i===0} className="text-slate-300 hover:text-slate-600 disabled:opacity-20 transition text-xs px-1">↑</button>
                                  <button onClick={async()=>{ await api(`/api/playlists/${pl.id}/songs/${s.id}/move`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({direction:'down'})}); fetchPlaylists(); }}
                                    disabled={i===pl.songs.length-1} className="text-slate-300 hover:text-slate-600 disabled:opacity-20 transition text-xs px-1">↓</button>
                                  {isTesting ? (
                                    <button onClick={()=>doAction(()=>api('/api/player/stop',{method:'POST'}).then(()=>{setTestingSongId(null);notify('הופסק')}))}
                                      className="bg-rose-100 text-rose-600 px-3 py-1.5 rounded-xl font-bold text-xs animate-pulse">⏹</button>
                                  ) : (
                                    <button onClick={async()=>{
                                      await api(`/api/playlists/${pl.id}/songs/${s.id}/play`,{method:'POST'});
                                      setTestingSongId({pid:pl.id,sid:s.id}); notify('▶ מנגן');
                                    }} className="bg-blue-50 text-blue-600 px-3 py-1.5 rounded-xl font-bold text-xs hover:bg-blue-100">▶</button>
                                  )}
                                  <button onClick={()=>setExpandedSongId(isExpanded?null:{pid:pl.id,sid:s.id})}
                                    className={`px-2.5 py-1.5 rounded-xl font-bold text-xs ${isExpanded?'bg-blue-600 text-white':'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                                    ✂️
                                  </button>
                                  <button onClick={()=>doAction(()=>api(`/api/playlists/${pl.id}/songs/${s.id}`,{method:'DELETE'}).then(()=>notify('הוסר')),fetchPlaylists)}
                                    className="text-rose-300 hover:text-rose-500 transition text-base flex-shrink-0">✕</button>
                                </div>
                                {isExpanded && (
                                  <div className="border-t border-slate-100 bg-blue-50/50 px-4 py-3">
                                    <SongRangeEditor song={s}
                                      audioUrl={s.file_path ? '/'+s.file_path : undefined}
                                      onSave={async(vals)=>{
                                        await api(`/api/playlists/${pl.id}/songs/${s.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(vals)});
                                        notify('נשמר'); fetchPlaylists();
                                      }}/>
                                  </div>
                                )}
                              </div>
                              );
                            })}
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                          <button onClick={()=>setShowAddSong(pl.id)}
                            className="bg-blue-50 text-blue-600 py-3 rounded-2xl font-black text-sm hover:bg-blue-100 transition">
                            + הוסף שיר
                          </button>
                          <button onClick={()=>setShowFolderImport(pl.id)}
                            className="bg-violet-50 text-violet-600 py-3 rounded-2xl font-black text-sm hover:bg-violet-100 transition">
                            📂 ייבוא תיקיה
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* VACATIONS */}
        {tab==='vacations' && (
          <div className="space-y-6">
            <div className="flex gap-3 justify-end flex-wrap">
              <button onClick={()=>setShowVacPDF(true)}
                className="bg-blue-600 text-white px-7 py-4 rounded-[24px] font-black shadow-xl shadow-blue-100 hover:bg-blue-700 transition text-sm">
                📄 ייבוא חופשות מ-PDF
              </button>
              <button onClick={()=>setShowImportFile(true)}
                className="bg-violet-600 text-white px-7 py-4 rounded-[24px] font-black shadow-xl shadow-violet-100 hover:bg-violet-700 transition text-sm">
                📊 ייבוא מ-Excel
              </button>
              <button onClick={()=>setShowICalImport(true)}
                className="bg-amber-500 text-white px-7 py-4 rounded-[24px] font-black shadow-xl shadow-amber-100 hover:bg-amber-600 transition text-sm">
                📅 ייבוא מ-Google / iCal
              </button>
              <button onClick={()=>setShowVacation(true)}
                className="bg-emerald-600 text-white px-7 py-4 rounded-[24px] font-black shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition text-sm">
                + הוסף חופשה
              </button>
            </div>
            <div className="bg-white rounded-[32px] shadow-sm border border-slate-100 p-7">
              {data.vacations.length===0 ? (
                <div className="text-center py-14 text-slate-300"><div className="text-5xl mb-3">📅</div><div className="font-bold">אין חופשות</div></div>
              ) : (
                <div className="space-y-3">
                  {data.vacations.map(v => (
                    <div key={v.date} className="flex justify-between items-center p-5 bg-slate-50 rounded-[20px] border border-slate-100">
                      <div className="flex items-center gap-4">
                        <span className="text-lg font-black text-slate-700 tabular-nums">{v.date}</span>
                        {v.label && <span className="text-slate-500 text-sm font-medium">{v.label}</span>}
                      </div>
                      <button onClick={()=>doAction(()=>api(`/api/vacations/${v.date}`,{method:'DELETE'}).then(()=>notify('הוסרה')))}
                        className="bg-rose-50 text-rose-500 px-5 py-2 rounded-xl font-bold text-sm hover:bg-rose-100">הסר</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Day overrides */}
            <div className="bg-white rounded-[32px] shadow-sm border border-slate-100 p-7">
              <div className="flex justify-between items-center mb-5">
                <div>
                  <h2 className="font-black text-lg">📆 ימים חריגים</h2>
                  <p className="text-slate-400 text-xs mt-0.5">יום שבו מערכת השעות תהיה כשל יום אחר</p>
                </div>
                <button onClick={()=>setShowDayOverride(true)}
                  className="bg-blue-600 text-white px-5 py-3 rounded-2xl font-black text-sm hover:bg-blue-700 transition">
                  + הוסף
                </button>
              </div>
              {dayOverrides.length===0
                ? <div className="text-center py-8 text-slate-300 text-sm">אין ימים חריגים</div>
                : <div className="space-y-2">
                    {dayOverrides.map(o=>(
                      <div key={o.date} className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl">
                        <div className="flex items-center gap-3">
                          <span className="font-black tabular-nums text-blue-600">{o.date}</span>
                          <span className="text-slate-400 text-sm">← מערכת יום {DAY_NAMES[o.from_day]}</span>
                          {o.label && <span className="text-slate-500 text-sm">({o.label})</span>}
                        </div>
                        <button onClick={()=>doAction(()=>api(`/api/day-overrides/${o.date}`,{method:'DELETE'}).then(()=>notify('הוסר')),fetchDayOverrides)}
                          className="text-rose-400 hover:text-rose-600 text-lg">✕</button>
                      </div>
                    ))}
                  </div>
              }
            </div>
          </div>
        )}

        {/* LOG */}
        {tab==='log' && (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-slate-400 text-sm font-medium">{bellLog.length} רשומות</p>
              <div className="flex gap-2">
                <button onClick={()=>{
                  const a=document.createElement('a'); a.href='/api/log/export';
                  a.download=`bell-log-${new Date().toISOString().slice(0,10)}.csv`; a.click();
                  notify('יוצא...');
                }} className="bg-emerald-100 text-emerald-700 px-5 py-3 rounded-[20px] font-black text-sm hover:bg-emerald-200 transition">
                  📥 ייצוא CSV
                </button>
                <button onClick={async()=>{
                  if (!window.confirm('למחוק את כל הרשומות ביומן?')) return;
                  await api('/api/log',{method:'DELETE'});
                  setBellLog([]); notify('✅ יומן נוקה');
                }} className="bg-slate-100 text-slate-600 px-5 py-3 rounded-[20px] font-black text-sm hover:bg-slate-200 transition">
                  🗑 נקה יומן
                </button>
              </div>
            </div>
            {bellLog.length===0
              ? <div className="bg-white rounded-[32px] p-16 text-center text-slate-300"><div className="text-5xl mb-3">📋</div><div className="font-bold">אין פעילות ביומן</div></div>
              : (() => {
                  const grouped = {};
                  [...bellLog].forEach(e => {
                    const date = (e.played_at||'').slice(0,10);
                    if (!grouped[date]) grouped[date] = [];
                    grouped[date].push(e);
                  });
                  const DAY_HE = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
                  return Object.entries(grouped).sort(([a],[b])=>b.localeCompare(a)).map(([date, entries]) => {
                    const d = new Date(date);
                    const dayName = !isNaN(d) ? DAY_HE[d.getDay()] : '';
                    return (
                      <LogDateGroup key={date} date={date} dayName={dayName} entries={entries}/>
                    );
                  });
                })()
            }
          </div>
        )}

        {/* EMERGENCY */}
        {tab==='emergency' && (
          <div className="space-y-6">
            {emergencyActive && (
              <div className="bg-rose-600 text-white p-6 rounded-[28px] flex items-center gap-4 animate-pulse">
                <span className="text-3xl">🚨</span>
                <div><div className="font-black text-lg">הודעת חירום פעילה!</div><div className="opacity-80 text-sm">מתנגנת ברמקולים</div></div>
              </div>
            )}
            <div className="flex justify-end">
              <button onClick={()=>setShowAddEmergency(true)}
                className="bg-rose-600 text-white px-7 py-4 rounded-[24px] font-black shadow-xl shadow-rose-100 hover:bg-rose-700 transition text-sm">
                + הוסף הודעת חירום
              </button>
            </div>
            {emergency.length===0 ? (
              <div className="bg-white rounded-[32px] p-16 text-center text-slate-300">
                <div className="text-5xl mb-3">🚨</div><div className="font-bold">אין הודעות חירום שמורות</div>
                <div className="text-sm mt-2">הוסף הודעה ותוכל לנגן אותה בלחיצה אחת</div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {emergency.map(f => (
                  <div key={f.id} className="bg-white rounded-[28px] shadow-sm border border-slate-100 p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div><span className="text-2xl">🔊</span></div>
                      <button onClick={()=>doAction(()=>api(`/api/emergency/${f.id}`,{method:'DELETE'}).then(()=>notify('נמחק')),fetchEmergency)}
                        className="text-slate-300 hover:text-rose-500 transition text-xl">✕</button>
                    </div>
                    <div className="font-black text-lg mb-4">{f.label}</div>
                    <button onClick={()=>doAction(()=>api(`/api/emergency/${f.id}/play`,{method:'POST'}).then(()=>notify('🚨 מנגן חירום!')))}
                      className="w-full bg-rose-600 text-white py-4 rounded-[20px] font-black text-base hover:bg-rose-700 transition shadow-lg shadow-rose-100">
                      🚨 נגן עכשיו
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Emergency Log */}
            <div className="bg-white rounded-[32px] shadow-sm border border-slate-100 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-black text-lg text-slate-700">📋 היסטוריית אירועי חירום</h3>
                {emergencyLog.length > 0 && (
                  <button onClick={()=>{ if(window.confirm('למחוק את כל ההיסטוריה?')) api('/api/emergency/log',{method:'DELETE'}).then(fetchEmergencyLog); }}
                    className="text-xs text-slate-400 hover:text-rose-500 transition">🗑 נקה</button>
                )}
              </div>
              {emergencyLog.length === 0 ? (
                <div className="text-center text-slate-300 py-6 text-sm">אין אירועי חירום מוקלטים</div>
              ) : (
                <div className="space-y-0 max-h-80 overflow-y-auto divide-y divide-slate-50">
                  {emergencyLog.map(e => {
                    const typeLbl = e.type==='pikud'?'🚨 פיקוד העורף':e.type==='test'?'🧪 בדיקה':'🔊 הודעה';
                    const typeCls = e.type==='pikud'?'bg-rose-100 text-rose-700':e.type==='test'?'bg-slate-100 text-slate-500':'bg-orange-100 text-orange-700';
                    let details = {}; try { details = JSON.parse(e.details||'{}'); } catch {}
                    return (
                      <div key={e.id} className="flex items-start gap-3 py-3">
                        <span className={`text-xs font-black px-2.5 py-1 rounded-full flex-shrink-0 mt-0.5 ${typeCls}`}>{typeLbl}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-sm text-slate-700">{e.label}</div>
                          {details.areas?.length > 0 && (
                            <div className="text-xs text-slate-400 truncate">{details.areas.join(', ')}</div>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 flex-shrink-0">
                          {new Date(e.fired_at).toLocaleString('he-IL')}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* SETTINGS */}
        {tab==='settings' && (
          <div className="max-w-2xl space-y-6">

            {/* כרטיס הפעלה מחדש */}
            <SettingsCard title="ניהול שרת" icon="⚙️">
              <RestartServerCard />
            </SettingsCard>

            <SettingsCard title="פרטי המוסד" icon="🏫">
              <SettingField label="שם בית הספר" value={data.settings.school_name||''} placeholder="לדוגמה: בית ספר יסודי"
                onSave={v=>doAction(()=>api('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'school_name',value:v})}).then(()=>notify('נשמר')))}/>
              <SettingField label="שם המנהל" value={data.settings.principal_name||''} placeholder="לדוגמה: ישראל ישראלי"
                onSave={v=>doAction(()=>api('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'principal_name',value:v})}).then(()=>notify('נשמר')))}/>
            </SettingsCard>

            <SettingsCard title="התקן שמע" icon="🔊">
              <label className="block text-sm font-bold text-slate-400 mb-2">התקן יציאה:</label>
              <select value={data.settings.output_device||'default'}
                onChange={e=>doAction(()=>api('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'output_device',value:e.target.value})}).then(()=>notify('נשמר')))}
                className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500">
                {devices.map(d=><option key={d} value={d}>{d==='default'?'ברירת מחדל (מערכת)':d}</option>)}
              </select>
              <button onClick={()=>api('/api/audio-devices').then(d=>{setDevices(d.devices);notify('עודכן');})}
                className="mt-3 bg-slate-100 text-slate-600 px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-slate-200">
                🔄 רענן רשימה
              </button>
            </SettingsCard>

            <SettingsCard title="עוצמת קול" icon="🔉">
              <label className="block text-sm font-bold text-slate-400 mb-2">עוצמה ראשית: {data.settings.master_volume||80}%</label>
              <input type="range" min="0" max="100" value={data.settings.master_volume||80}
                onChange={e=>doAction(()=>api('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'master_volume',value:e.target.value})}))}
                className="w-full h-3 bg-slate-100 rounded-full appearance-none cursor-pointer accent-blue-600"/>
            </SettingsCard>


            <SettingsCard title="פיקוד העורף – התראות חירום" icon="🚨">
              {/* Enable toggle */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="font-bold">השמעה אוטומטית של אזעקת פיקוד העורף</div>
                  <div className="text-xs text-slate-400 mt-1">המערכת בודקת כל 5 שניות — בעת אזעקה תושמע סירנה ברמקולים</div>
                </div>
                <Toggle checked={pikudEnabled} onChange={async()=>{
                  const r = await api('/api/pikud/toggle',{method:'POST'}); setPikudEnabled(r.enabled); setPikudStatus(s=>({...s,enabled:r.enabled}));
                  notify(r.enabled?'✅ פיקוד העורף מופעל':'פיקוד העורף כבוי');
                  setTimeout(fetchPikud, 1000);
                }}/>
              </div>

              {/* Location filter */}
              <div className="mb-4">
                <label className="block text-sm font-bold text-slate-500 mb-2">ישוב / עיר לסינון (חובה לדיוק מיקום)</label>
                <SettingField label="" value={data.settings.pikud_location||''} placeholder="לדוגמה: תל אביב / אשדוד / ירושלים"
                  onSave={v=>doAction(()=>api('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'pikud_location',value:v})}).then(()=>{notify('✅ ישוב נשמר — האזעקה תושמע רק לישוב זה');fetchData();}))}/>
                <div className="text-xs text-slate-400 -mt-3">ריק = השמע לכל אזעקה בישראל (לא מומלץ)</div>
              </div>

              {/* Status panel */}
              {pikudEnabled && playerStatus.process_active && !emergencyActive && !announceActive && !playerStatus.playing && (
                <div className="bg-red-600 rounded-2xl px-4 py-3 mb-4 flex items-center gap-3 animate-pulse">
                  <span className="text-white text-lg">🚨</span>
                  <span className="flex-1 text-white font-black text-sm">סירנת פיקוד העורף!</span>
                  <button onClick={()=>doAction(()=>api('/api/player/stop',{method:'POST'}).then(()=>notify('סירנה הופסקה')))}
                    className="bg-white/20 hover:bg-white/30 text-white px-4 py-1.5 rounded-xl font-bold text-xs transition">
                    ⏹ עצור
                  </button>
                </div>
              )}

              {pikudEnabled && (
                <div className="space-y-2 mb-4">
                  <div className={`flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-bold ${pikudStatus.pollError?'bg-rose-50 text-rose-600':'bg-emerald-50 text-emerald-700'}`}>
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${pikudStatus.pollError?'bg-rose-500':'bg-emerald-500 animate-pulse'}`}/>
                    {pikudStatus.pollError
                      ? `⚠️ שגיאת חיבור: ${pikudStatus.pollError}`
                      : pikudStatus.lastPoll
                        ? `✅ מחובר — בדיקה אחרונה: ${new Date(pikudStatus.lastPoll).toLocaleTimeString('he-IL')}`
                        : '⏳ ממתין לבדיקה ראשונה...'}
                  </div>
                  {pikudStatus.lastAlert && (
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-2 text-xs text-amber-700">
                      <span className="font-black">אזעקה אחרונה: </span>
                      {pikudStatus.lastAlert.title} — {(pikudStatus.lastAlert.data||[]).join(', ')}
                    </div>
                  )}
                </div>
              )}

              {/* Siren file */}
              <div className="mb-4">
                <label className="block text-sm font-bold text-slate-500 mb-2">קובץ סירנה מותאם אישית</label>
                <div className="flex gap-2">
                  <label className="flex-1 cursor-pointer bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl text-center py-3 px-4 text-sm text-slate-400 hover:bg-slate-100 transition">
                    📁 העלה קובץ סירנה (.mp3 / .wav / .ogg)
                    <input type="file" accept=".mp3,.wav,.ogg,.aac,.flac,.m4a" className="hidden"
                      onChange={async e => {
                        const file = e.target.files?.[0]; if (!file) return;
                        const fd = new FormData(); fd.append('file', file);
                        try {
                          const r = await fetch('/api/pikud/siren',{method:'POST',body:fd});
                          if (!r.ok) throw new Error('שגיאה');
                          notify('✅ קובץ סירנה הועלה — יופעל באזעקה הבאה');
                        } catch { notify('שגיאה בהעלאה','error'); }
                        e.target.value = '';
                      }}/>
                  </label>
                  <button onClick={async()=>{
                    if (!confirm('לאפס לסירנה האוטומטית?')) return;
                    await api('/api/pikud/siren',{method:'DELETE'});
                    notify('🔄 הסירנה האוטומטית תיווצר מחדש');
                  }} className="px-4 py-3 rounded-2xl bg-slate-100 text-slate-500 font-bold text-xs hover:bg-slate-200 transition whitespace-nowrap">
                    🔄 ברירת מחדל
                  </button>
                </div>
                <div className="text-xs text-slate-400 mt-1">ריק = סירנה אוטומטית (נוצרת על-ידי המערכת)</div>
              </div>

              {/* Test button */}
              <button onClick={async()=>{
                try { await api('/api/pikud/test',{method:'POST'}); notify('🚨 מנגן אזעקת בדיקה (3 שניות)'); }
                catch(e) { notify(e.message,'error'); }
              }} className="w-full bg-rose-600 text-white py-3 rounded-2xl font-black text-sm hover:bg-rose-700 transition">
                🚨 בדוק אזעקה (3 שניות)
              </button>
            </SettingsCard>

            {/* Hebrew Calendar */}
            <SettingsCard title="לוח עברי – תבניות עונתיות" icon="📅">
              {hebrewInfo?.available ? (
                <div>
                  <div className="bg-blue-50 rounded-2xl px-5 py-4 mb-5 text-center">
                    <div className="text-2xl font-black text-blue-800">
                      {hebrewInfo.dayHe} {hebrewInfo.monthHe} {hebrewInfo.year}
                    </div>
                    {hebrewInfo.holidays?.length > 0 && (
                      <div className="mt-2 flex flex-wrap justify-center gap-2">
                        {hebrewInfo.holidays.map(h=>(
                          <span key={h.key} className="bg-amber-100 text-amber-700 text-xs font-bold px-3 py-1 rounded-full">{h.he||h.desc}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Template Rules */}
                  <p className="text-slate-400 text-sm mb-3">כשמזוהה חג, המערכת תפעיל תבנית לוח שעות מיוחדת אוטומטית.</p>
                  <div className="space-y-2 mb-5">
                    {templateRules.length === 0 && <p className="text-slate-300 text-sm text-center py-2">אין חוקים מוגדרים</p>}
                    {templateRules.map(r => (
                      <div key={r.id} className="flex items-center gap-2 bg-slate-50 rounded-2xl px-4 py-3">
                        <div className="flex-1">
                          <div className="text-sm font-bold text-slate-700">{r.label}</div>
                          <div className="text-xs text-slate-400">{r.rule_type==='holiday'?'🗓 חג':'📆 טווח תאריכים'} · תבנית: {r.template_name}</div>
                        </div>
                        <button onClick={async()=>{
                          await fetch(`/api/template-rules/${r.id}`,{method:'DELETE'});
                          fetchTemplateRules();
                          notify('נמחק');
                        }} className="bg-red-100 text-red-600 px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-red-200 transition">🗑</button>
                      </div>
                    ))}
                  </div>

                  {/* Add Rule */}
                  <HebrewTemplateRuleForm
                    templates={templates}
                    upcomingHolidays={upcomingHolidays}
                    onAdd={async(rule)=>{
                      const r = await fetch('/api/template-rules',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(rule)});
                      const d = await r.json();
                      if(d.error) notify(d.error,'error'); else { notify('✅ חוק נוסף'); fetchTemplateRules(); }
                    }}
                  />

                  {/* Active template notice */}
                  {data.settings.active_template_id && (
                    <div className="mt-4 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center justify-between">
                      <span className="text-amber-700 text-sm font-bold">📅 תבנית מיוחדת פעילה היום</span>
                      <button onClick={async()=>{
                        await api('/api/templates/deactivate',{method:'POST'});
                        notify('בוטל — חזרה ללוח שעות רגיל');
                        fetchData();
                      }} className="bg-amber-100 text-amber-700 px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-amber-200">בטל</button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-slate-400 text-sm text-center py-4">
                  <div className="text-3xl mb-2">📅</div>
                  ספריית לוח עברי לא נטענה
                </div>
              )}
            </SettingsCard>

            <SettingsCard title="גיבוי ושחזור" icon="💾">
              <p className="text-slate-400 text-sm mb-5">ייצא את כל הגדרות המערכת לקובץ JSON ושחזר בהמשך</p>
              <div className="flex gap-3 flex-wrap">
                <button onClick={async()=>{
                  try {
                    const r = await fetch('/api/backup');
                    const blob = await r.blob();
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `tzalzuli-backup-${new Date().toISOString().slice(0,10)}.json`;
                    a.click();
                    notify('גיבוי הורד');
                  } catch { notify('שגיאה','error'); }
                }} className="flex-1 bg-blue-600 text-white py-3.5 rounded-2xl font-black text-sm hover:bg-blue-700 transition">
                  ⬇️ ייצא גיבוי
                </button>
                <label className="flex-1 bg-slate-100 text-slate-600 py-3.5 rounded-2xl font-black text-sm hover:bg-slate-200 transition text-center cursor-pointer">
                  ⬆️ שחזר מגיבוי
                  <input type="file" accept=".json" className="hidden" onChange={async e=>{
                    const file = e.target.files[0]; if (!file) return;
                    if (!confirm('זה ישחזר ויחליף את כל הנתונים. להמשיך?')) return;
                    try {
                      const text = await file.text();
                      const data = JSON.parse(text);
                      await api('/api/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
                      notify('שוחזר בהצלחה');
                      await fetchData(); await fetchPlaylists();
                    } catch(e) { notify(e.message,'error'); }
                    e.target.value = '';
                  }}/>
                </label>
              </div>
            </SettingsCard>

            {!isMobile && <SettingsCard title="התראת מייל – כתובת גישה מרחוק" icon="📧">
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 mb-5 text-sm text-blue-700 leading-relaxed">
                <strong>למה זה נצרך?</strong> כשהמחשב מופעל מחדש, כתובת הגישה מרחוק משתנה.
                המייל ישלח אוטומטית לכל שינוי כתובת, כדי שתוכל להתחבר גם מהבית.
              </div>
              <SettingField label="מייל לשליחת התראה אל" value={data.settings.notify_email||''} placeholder="principal@school.com"
                onSave={v=>doAction(()=>api('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'notify_email',value:v})}).then(()=>notify('נשמר')))}/>
              <div className="mt-1 mb-3 text-xs text-slate-400 font-bold bg-amber-50 border border-amber-100 rounded-xl p-3">
                ✉️ שליחה דרך Gmail — נדרש חשבון Gmail ו&quot;App Password&quot;
                <br/>
                <span className="text-amber-600">הוראה: Gmail ← הגדרות ← אבטחה ← אימות דו-שלבי ← App passwords ← צור סיסמה לאפליקציה</span>
              </div>
              <SettingField label="כתובת Gmail לשליחה" value={data.settings.gmail_user||''} placeholder="school@gmail.com"
                onSave={v=>doAction(()=>api('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'gmail_user',value:v})}).then(()=>notify('נשמר')))}/>
              <SettingField label="App Password של Gmail (16 תווים)" value={data.settings.gmail_pass||''} placeholder="xxxx xxxx xxxx xxxx"
                onSave={v=>doAction(()=>api('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'gmail_pass',value:v})}).then(()=>notify('נשמר')))}/>
              <button
                onClick={()=>doAction(()=>api('/api/settings/test-email',{method:'POST'}).then(()=>notify('מייל בדיקה נשלח ✅')))}
                className="mt-2 w-full bg-blue-600 text-white py-3.5 rounded-2xl font-black text-sm hover:bg-blue-700 transition">
                📤 שלח מייל בדיקה עם הכתובת הנוכחית
              </button>
            </SettingsCard>}
          </div>
        )}
      </main>

      {/* BOTTOM NAV (mobile) */}
      <nav className="fixed bottom-0 inset-x-0 flex md:hidden bg-white border-t border-slate-100 z-40 shadow-2xl">
        {navItems.map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)}
            className={`flex-1 flex flex-col items-center py-3 gap-0.5 transition-all ${tab===t.id?'text-blue-600':'text-slate-400'}`}>
            <span className="text-xl">{t.icon}</span>
            <span className="text-[10px] font-black">{t.label}</span>
          </button>
        ))}
      </nav>

      {/* Emergency FAB (mobile) — small, unobtrusive unless active */}
      <button onClick={()=>setShowEmergencyPanel(true)}
        className={`fixed bottom-20 left-3 md:hidden w-10 h-10 rounded-full z-40 shadow-lg flex items-center justify-center text-lg transition-all ${emergencyActive?'bg-rose-600 animate-pulse shadow-rose-300':'bg-rose-100 shadow-slate-200'}`}>
        {emergencyActive ? '🚨' : <span className="text-rose-500 text-base">🚨</span>}
      </button>


      {/* ===== MODALS ===== */}

      {(showAddBell||editBell) && (
        <BellModal bell={editBell} playlists={playlists} devices={devices} sounds={sounds} presets={bellPresets} onClose={()=>{setShowAddBell(false);setEditBell(null);}}
          onSave={async formData => {
            if(editBell) {
              const fd = new FormData();
              Object.entries(formData).forEach(([k,v])=>{ if(v!==null&&v!==undefined&&k!=='breakPreset') fd.append(k,v); });
              const res = await fetch(`/api/bells/${editBell.id}`,{method:'PUT',body:fd});
              if(!res.ok){const e=await res.json().catch(()=>({error:'שגיאת שרת'}));throw new Error(e.error);}
              if(formData.bell_type==='break_start' && (formData.break_duration||0)>0) {
                const endTime = minutesToTime(timeToMinutes(formData.time) + Number(formData.break_duration));
                const existing = data.bells.find(b=>b.id!==editBell.id && b.time===endTime && (b.days||'0,1,2,3,4,5').split(',').some(d=>(formData.days||'0,1,2,3,4,5').split(',').includes(d)));
                if(!existing) {
                  const fd2=new FormData(); fd2.append('label','תחילת שיעור'); fd2.append('time',endTime);
                  fd2.append('days',formData.days||'0,1,2,3,4,5'); fd2.append('bell_type','lesson_start');
                  fd2.append('volume',formData.volume||80); fd2.append('audio_type','local_path'); fd2.append('local_path',formData.local_path||'');
                  await fetch('/api/bells',{method:'POST',body:fd2});
                  notify(`✅ עודכן + נוסף צלצול תחילת שיעור ב-${endTime}`); }
                else notify('עודכן');
              } else notify('עודכן');
            } else {
              const fd = new FormData();
              Object.entries(formData).forEach(([k,v])=>{if(v!==null)fd.append(k,v);});
              const res = await fetch('/api/bells',{method:'POST',body:fd});
              if(!res.ok){const e=await res.json().catch(()=>({error:'שגיאת שרת'}));throw new Error(e.error);}
              notify('נוסף');
              if(formData.bell_type==='break_start' && (formData.break_duration||0)>0) {
                const endTime = minutesToTime(timeToMinutes(formData.time) + Number(formData.break_duration));
                const existing = data.bells.find(b=>b.time===endTime && (b.days||'0,1,2,3,4,5').split(',').some(d=>(formData.days||'0,1,2,3,4,5').split(',').includes(d)));
                if(!existing) {
                  const fd2 = new FormData();
                  fd2.append('label','תחילת שיעור'); fd2.append('time',endTime);
                  fd2.append('days',formData.days||'0,1,2,3,4,5'); fd2.append('bell_type','lesson_start');
                  fd2.append('volume',formData.volume||80); fd2.append('duration',formData.duration||0);
                  fd2.append('break_duration',0); fd2.append('audio_type','local_path'); fd2.append('local_path',formData.local_path||'');
                  if(formData.playlist_id) fd2.append('playlist_id',formData.playlist_id);
                  await fetch('/api/bells',{method:'POST',body:fd2});
                  notify(`✅ נוסף צלצול תחילת שיעור ב-${endTime} אוטומטית`);
                }
              }
            }
            // Save preset for this bell_type
            try {
              await api(`/api/bell-presets/${formData.bell_type}`,{
                method:'POST',headers:{'Content-Type':'application/json'},
                body:JSON.stringify({
                  volume:formData.volume, duration:formData.duration,
                  repeat_count:formData.repeat_count, output_device:formData.output_device||'',
                  audio_source:formData.local_path||'', start_time:formData.start_time||0,
                })
              });
              fetchBellPresets();
            } catch {}
            await fetchData(); setShowAddBell(false); setEditBell(null);
          }}/>
      )}

      {showPDFImport && (
        <PDFImportModal
          onClose={()=>setShowPDFImport(false)}
          onImport={async (bells) => {
            for (const b of bells) {
              const fd = new FormData();
              fd.append('label', b.label || getBellTypeInfo(b.bell_type).label);
              fd.append('time',  b.time);
              fd.append('days',  b.days || '0,1,2,3,4,5');
              fd.append('bell_type', b.bell_type || 'custom');
              fd.append('volume', 80);
              fd.append('audio_type', 'local_path');
              fd.append('local_path', bellPresets[b.bell_type]?.audio_source || '');
              fd.append('break_duration', b.break_duration || 0);
              await fetch('/api/bells',{method:'POST',body:fd});
            }
            notify(`✅ יובאו ${bells.length} צלצולים`);
            await fetchData();
            setShowPDFImport(false);
          }}/>
      )}

      {showImportSchedule && (
        <ImportScheduleModal
          onClose={()=>setShowImportSchedule(false)}
          onImport={async (bells) => {
            for (const b of bells) {
              const fd = new FormData();
              fd.append('label',          b.label);
              fd.append('time',           b.time);
              fd.append('days',           b.days || '0,1,2,3,4,5');
              fd.append('audio_type',     b.audio_type || 'local_path');
              fd.append('local_path',     b.local_path || '');
              fd.append('volume',         b.volume || 80);
              fd.append('duration',       b.duration || 0);
              fd.append('bell_type',      b.bell_type || 'custom');
              fd.append('break_duration', b.break_duration || 0);
              if (b.file) fd.append('file', b.file);
              await fetch('/api/bells', { method:'POST', body: fd });
            }
            notify(`יובאו ${bells.length} צלצולים`);
            await fetchData();
            setShowImportSchedule(false);
          }}/>
      )}

      {showCopyDay && (
        <CopyDayModal
          initialFromDay={filterDay ?? 0}
          onClose={()=>setShowCopyDay(false)}
          onCopy={async ({fromDay,toDay})=>{
            const r = await api('/api/bells/copy-day',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fromDay,toDay})});
            notify(r.count > 0 ? `✅ הועתקו ${r.count} צלצולים` : 'לא נמצאו צלצולים להעתקה');
            await fetchData();
            setShowCopyDay(false);
          }}/>
      )}

      {showVacation && (
        <VacationModal onClose={()=>setShowVacation(false)}
          onSave={async({dates,label})=>{
            await api('/api/vacations/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vacations:dates.map(d=>({date:d,label}))})});
            notify(dates.length===1?'נוסף':`נוספו ${dates.length} ימים`); await fetchData(); setShowVacation(false);
          }}/>
      )}

      {showImportFile && (
        <ImportFileModal onClose={()=>setShowImportFile(false)}
          onImport={async vacations=>{
            await api('/api/vacations/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vacations})});
            notify(`יובאו ${vacations.length} ימים`); await fetchData(); setShowImportFile(false);
          }}/>
      )}

      {showICalImport && (
        <ICalImportModal onClose={()=>setShowICalImport(false)}
          onImport={async count=>{ notify(`יובאו ${count} ימים`); await fetchData(); setShowICalImport(false); }}/>
      )}

      {(showAddPlaylist||editPlaylist) && (
        <PlaylistModal playlist={editPlaylist} onClose={()=>{setShowAddPlaylist(false);setEditPlaylist(null);}}
          onSave={async f=>{
            if(editPlaylist) await api(`/api/playlists/${editPlaylist.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(f)});
            else await api('/api/playlists',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(f)});
            notify(editPlaylist?'עודכן':'נוסף'); await fetchPlaylists(); setShowAddPlaylist(false); setEditPlaylist(null);
          }}/>
      )}

      {showAddSong && (
        <AddSongModal onClose={()=>setShowAddSong(null)}
          onSave={async formData=>{
            const fd = new FormData();
            Object.entries(formData).forEach(([k,v])=>{if(v!==null)fd.append(k,v);});
            const res = await fetch(`/api/playlists/${showAddSong}/songs`,{method:'POST',body:fd});
            if(!res.ok){const e=await res.json();throw new Error(e.error);}
            notify('נוסף'); await fetchPlaylists(); setShowAddSong(null);
          }}/>
      )}

      {showAddEmergency && (
        <AddEmergencyModal onClose={()=>setShowAddEmergency(false)}
          onSave={async formData=>{
            const fd = new FormData();
            Object.entries(formData).forEach(([k,v])=>{if(v!==null)fd.append(k,v);});
            const res = await fetch('/api/emergency',{method:'POST',body:fd});
            if(!res.ok){const e=await res.json();throw new Error(e.error);}
            notify('נוסף'); await fetchEmergency(); setShowAddEmergency(false);
          }}/>
      )}

      {showAnnounce && (
        <AnnounceModal
          announceActive={announceActive}
          onClose={()=>setShowAnnounce(false)}
          onLeaveMessage={()=>{ setShowAnnounce(false); setShowScheduledPlay(true); }}/>
      )}

      {showVacPDF && (
        <PDFVacationImportModal
          onClose={()=>setShowVacPDF(false)}
          onImport={async days=>{
            await api('/api/vacations/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vacations:days})});
            notify(`✅ יובאו ${days.length} ימי חופשה`);
            await fetchData();
            setShowVacPDF(false);
          }}/>
      )}

      {showRemoteAccess && (
        <RemoteAccessModal tunnelInfo={tunnelInfo} onClose={()=>setShowRemoteAccess(false)}/>
      )}

      {showScheduledPlay && (
        <ScheduledPlayModal
          onClose={()=>setShowScheduledPlay(false)}
          onSave={async formData=>{
            const fd = new FormData();
            Object.entries(formData).forEach(([k,v])=>{if(v!==null&&v!==undefined&&v!=='')fd.append(k,v);});
            const res = await fetch('/api/scheduled-play',{method:'POST',body:fd});
            if(!res.ok){const e=await res.json().catch(()=>({error:'שגיאת שרת'}));throw new Error(e.error);}
            setShowScheduledPlay(false);
            fetchScheduledPlays();
            if (!formData.play_at) {
              // ניגון מיידי — מציגים toast עם כפתור עצור ל-8 שניות
              const el = document.createElement('div');
              el.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);background:#1e40af;color:white;padding:14px 20px;border-radius:24px;font-weight:900;z-index:9999;box-shadow:0 8px 30px rgba(0,0,0,.2);direction:rtl;font-size:15px;display:flex;align-items:center;gap:12px';
              el.innerHTML = '<span>▶ מנגן עכשיו</span><button style="background:rgba(255,255,255,0.2);border:none;color:white;padding:6px 14px;border-radius:12px;font-weight:900;cursor:pointer;font-size:13px">⏹ עצור</button>';
              el.querySelector('button').onclick = () => { fetch('/api/player/stop',{method:'POST'}); el.remove(); };
              document.body.appendChild(el);
              setTimeout(() => el.remove(), 8000);
            } else {
              notify('⏰ הודעה תוזמנה');
            }
          }}/>
      )}

      {showAssignPlaylist && (
        <AssignPlaylistModal
          playlistId={showAssignPlaylist}
          playlists={playlists}
          bells={data.bells}
          onClose={()=>setShowAssignPlaylist(null)}
          onAssign={async(bellId,plId)=>{
            const bell = data.bells.find(b=>b.id===bellId);
            await api(`/api/bells/${bellId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...bell,playlist_id:plId||null})});
            notify(plId?'✅ פלייליסט שויך':'הוסר פלייליסט'); await fetchData();
          }}/>
      )}

      {showDayOverride && (
        <DayOverrideModal
          onClose={()=>setShowDayOverride(false)}
          onSave={async({date,from_day,label})=>{
            await api('/api/day-overrides',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,from_day,label})});
            notify('יום חריג נוסף'); await fetchDayOverrides(); setShowDayOverride(false);
          }}/>
      )}

      {showFolderImport && (
        <FolderImportModal
          onClose={()=>setShowFolderImport(null)}
          onImport={async folderPath=>{
            await api(`/api/playlists/${showFolderImport}/import-folder`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder_path:folderPath})});
            notify('יובאו קבצים מהתיקיה');
            await fetchPlaylists();
            setShowFolderImport(null);
          }}/>
      )}

      {showSilentModal && (
        <SilentModal
          silentMode={silentMode}
          onClose={()=>setShowSilentModal(false)}
          onApply={async minutes=>{
            const r = await api('/api/silent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({minutes})});
            setSilentMode(r);
            notify(minutes>0?`🔇 שקט למשך ${minutes<60?minutes+' דקות':Math.round(minutes/60)+' שעות'}`:'מצב שקט בוטל');
            setShowSilentModal(false);
          }}/>
      )}

      {showCheckFiles && fileCheckResults && (
        <FileCheckModal results={fileCheckResults} onClose={()=>setShowCheckFiles(false)}/>
      )}

      {showTemplates && (
        <TemplateModal
          templates={templates}
          onClose={()=>setShowTemplates(false)}
          onSave={async name=>{
            await api('/api/templates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
            notify('תבנית נשמרה'); await fetchTemplates();
          }}
          onLoad={async id=>{
            await api(`/api/templates/${id}/apply`,{method:'POST'});
            notify('✅ תבנית הוחלה — צלצולים הוחלפו לצמיתות'); await fetchData(); setShowTemplates(false);
          }}
          onActivate={async id=>{
            await api(`/api/templates/${id}/activate`,{method:'POST'});
            notify('📅 תבנית פעילה להיום בלבד'); await fetchData(); setShowTemplates(false);
          }}
          onDelete={async id=>{
            await api(`/api/templates/${id}`,{method:'DELETE'});
            notify('נמחקה'); await fetchTemplates();
          }}/>
      )}

      {showEmergencyPanel && (
        <Modal onClose={()=>setShowEmergencyPanel(false)}>
          <div className="flex items-center gap-3 mb-6">
            <span className="text-3xl">🚨</span>
            <div><h2 className="text-2xl font-black">חירום</h2><p className="text-slate-400 text-sm">נגן הודעת חירום מיידית</p></div>
          </div>
          {emergency.length===0 ? (
            <div className="text-center py-8 text-slate-400">
              <div className="text-4xl mb-2">🔊</div>
              <div className="font-bold">אין הודעות חירום שמורות</div>
            </div>
          ) : (
            <div className="space-y-3">
              {emergency.map(f=>(
                <button key={f.id}
                  onClick={()=>doAction(()=>api(`/api/emergency/${f.id}/play`,{method:'POST'}).then(()=>{notify('🚨 חירום פעיל!');setShowEmergencyPanel(false);}))}
                  className="w-full bg-rose-600 text-white p-5 rounded-[22px] font-black text-lg hover:bg-rose-700 transition shadow-lg shadow-rose-100 flex items-center gap-4">
                  <span className="text-2xl">🔊</span> {f.label}
                </button>
              ))}
            </div>
          )}
          <button onClick={()=>setShowEmergencyPanel(false)}
            className="w-full mt-5 py-4 rounded-2xl font-black text-slate-400 bg-slate-50">סגור</button>
        </Modal>
      )}
    </div>
  );
}

// ===== Song Range Editor (for playlist songs) =====
function SongRangeEditor({ song, onSave, audioUrl }) {
  const [startTime, setStartTime] = useState(song.start_time || 0);
  const [duration,  setDuration]  = useState(song.duration  || 0);
  const [saving,    setSaving]    = useState(false);
  const [clickMode, setClickMode] = useState('start');

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-black text-blue-700">✂️ טווח ניגון</div>
        {audioUrl && (
          <div className="flex gap-1">
            <button onClick={() => setClickMode('start')}
              className={`text-xs px-2.5 py-1 rounded-lg font-bold transition ${clickMode === 'start' ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
              ▶ התחלה
            </button>
            <button onClick={() => setClickMode('end')}
              className={`text-xs px-2.5 py-1 rounded-lg font-bold transition ${clickMode === 'end' ? 'bg-green-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
              ⏹ סיום
            </button>
          </div>
        )}
      </div>
      {audioUrl && (
        <AudioWaveform
          audioUrl={audioUrl}
          startTime={startTime}
          duration={duration}
          clickMode={clickMode}
          onChange={v => setStartTime(v)}
          onChangeEnd={endTime => setDuration(Math.max(0, Math.round((endTime - startTime) * 10) / 10))}
        />
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-bold text-blue-600 mb-1">התחלה (שניות)</label>
          <input type="number" min="0" max="3600" step="0.5" value={startTime}
            onChange={e=>setStartTime(parseFloat(e.target.value)||0)}
            className="w-full p-2 bg-white rounded-xl border border-blue-200 font-bold text-center text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-blue-600 mb-1">משך (שניות, 0=הכל)</label>
          <input type="number" min="0" max="3600" value={duration}
            onChange={e=>setDuration(parseInt(e.target.value)||0)}
            className="w-full p-2 bg-white rounded-xl border border-blue-200 font-bold text-center text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
        </div>
      </div>
      <button disabled={saving} onClick={async()=>{setSaving(true);try{await onSave({start_time:startTime,duration});}finally{setSaving(false);}}}
        className="w-full bg-blue-600 text-white py-2 rounded-xl font-black text-xs hover:bg-blue-700 transition disabled:opacity-50">
        {saving?'שומר...':'שמור טווח'}
      </button>
    </div>
  );
}

// ===== Settings helpers =====
function SettingsCard({ title, icon, children }) {
  return (
    <div className="bg-white p-7 rounded-[32px] shadow-sm border border-slate-100">
      <h2 className="text-lg font-bold mb-5">{icon} {title}</h2>
      {children}
    </div>
  );
}

function SettingField({ label, value, placeholder, onSave }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div className="mb-5">
      <label className="block text-sm font-bold text-slate-400 mb-2">{label}</label>
      <div className="flex gap-3">
        <input value={v} onChange={e=>setV(e.target.value)} placeholder={placeholder}
          className="flex-1 p-4 bg-slate-50 rounded-2xl border border-slate-200 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"/>
        <button onClick={()=>onSave(v)} className="bg-blue-600 text-white px-5 rounded-2xl font-black text-sm hover:bg-blue-700">שמור</button>
      </div>
    </div>
  );
}

// ===== Audio Waveform =====
function AudioWaveform({ audioUrl, startTime = 0, duration = 0, onChange, onChangeEnd, clickMode = 'start' }) {
  const canvasRef = useRef(null);
  const [peaks, setPeaks] = useState(null);
  const [audioDur, setAudioDur] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!audioUrl) { setPeaks(null); setLoading(false); return; }
    setLoading(true); setPeaks(null);
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(audioUrl);
        if (!r.ok) throw new Error('');
        const buf = await r.arrayBuffer();
        if (cancelled) return;
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const decoded = await ctx.decodeAudioData(buf);
        if (cancelled) return;
        setAudioDur(decoded.duration);
        const data = decoded.getChannelData(0);
        const N = 300, bs = Math.floor(data.length / N);
        const p = [];
        for (let i = 0; i < N; i++) {
          let max = 0;
          for (let j = 0; j < bs; j++) max = Math.max(max, Math.abs(data[i * bs + j]));
          p.push(max);
        }
        setPeaks(p);
      } catch(e) {} finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [audioUrl]);

  useEffect(() => {
    if (!peaks || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const startPct = audioDur > 0 ? Math.min(1, startTime / audioDur) : 0;
    const endPct = audioDur > 0 && duration > 0 ? Math.min(1, (startTime + duration) / audioDur) : 1;
    const barW = Math.max(1, W / peaks.length - 0.5);
    peaks.forEach((p, i) => {
      const x = (i / peaks.length) * W;
      const h = p * H * 0.88;
      const pct = i / peaks.length;
      ctx.fillStyle = (pct >= startPct && pct <= endPct) ? '#3b82f6' : '#e2e8f0';
      ctx.fillRect(x, (H - h) / 2, barW, h);
    });
    if (startPct > 0.001) { ctx.fillStyle = '#ef4444'; ctx.fillRect(startPct * W - 1, 0, 2, H); }
    if (duration > 0 && endPct < 0.999) { ctx.fillStyle = '#22c55e'; ctx.fillRect(endPct * W - 1, 0, 2, H); }
  }, [peaks, startTime, duration, audioDur]);

  const handleClick = (e) => {
    if (!audioDur || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const time = Math.round(pct * audioDur * 10) / 10;
    if (clickMode === 'end') {
      onChangeEnd?.(time);
    } else {
      onChange?.(time);
    }
  };

  if (!audioUrl) return null;
  if (loading) return <div className="bg-slate-50 rounded-2xl h-14 flex items-center justify-center text-slate-400 text-xs">⏳ טוען גל קול...</div>;
  if (!peaks) return null;
  return (
    <div className="mt-2">
      <canvas ref={canvasRef} width={600} height={56} onClick={handleClick}
        className={`w-full rounded-2xl bg-slate-50 ${clickMode==='end' ? 'cursor-col-resize' : 'cursor-crosshair'}`}
        style={{height:'56px'}}/>
      <p className="text-xs text-slate-400 mt-1 text-center">
        {clickMode==='end' ? '🟢 לחץ לבחירת נקודת סיום' : '🔴 לחץ לבחירת נקודת התחלה'}
        {startTime > 0 ? ` · ▶ ${startTime}s` : ''}
        {duration > 0 ? ` · ⏹ ${(startTime+duration).toFixed(1)}s` : ''} · סה״כ: {audioDur.toFixed(1)}s
      </p>
    </div>
  );
}

// ===== PDF Import Modal =====
function PDFImportModal({ onClose, onImport }) {
  const [loading, setLoading] = useState(false);
  const [bells, setBells] = useState(null);
  const [days, setDays] = useState('0,1,2,3,4,5');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  const handleFile = async (file) => {
    setLoading(true); setError(''); setBells(null);
    const fd = new FormData(); fd.append('file', file);
    try {
      const r = await fetch('/api/import-schedule-pdf', { method: 'POST', body: fd });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setBells(d.bells || []);
    } catch(e) { setError(e.message); } finally { setLoading(false); }
  };

  const update = (i, k, v) => setBells(bs => bs.map((b, j) => j === i ? { ...b, [k]: v } : b));
  const remove = (i) => setBells(bs => bs.filter((_, j) => j !== i));

  return (
    <Modal onClose={onClose}>
      <h2 className="text-2xl font-black mb-2">📄 ייבוא לוח שעות מ-PDF</h2>
      <p className="text-slate-400 text-sm mb-5">העלה קובץ PDF של לוח שעות — המערכת תזהה שעות ותציע צלצולים.</p>

      {!bells && (
        <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-2xl p-10 cursor-pointer hover:border-violet-400 hover:bg-violet-50 transition">
          <span className="text-4xl mb-3">📄</span>
          <span className="font-bold text-slate-600">לחץ לבחירת קובץ PDF</span>
          <input type="file" accept=".pdf" className="hidden" onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value=''; }}/>
        </label>
      )}

      {loading && <div className="text-center py-10 text-slate-400">⏳ מנתח PDF...</div>}
      {error && <div className="bg-rose-50 text-rose-600 p-4 rounded-2xl text-sm font-bold">{error}</div>}

      {bells && (
        <>
          <div className="mb-4">
            <label className="block text-sm font-bold text-slate-400 mb-2">ימים:</label>
            <DaySelector value={days} onChange={setDays}/>
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto mb-5">
            {bells.map((b, i) => (
              <div key={i} className="flex items-center gap-2 bg-slate-50 rounded-2xl px-3 py-2">
                <input type="time" value={b.time} onChange={e=>update(i,'time',e.target.value)}
                  className="p-2 bg-white rounded-xl border border-slate-200 font-bold text-sm w-24 text-center"/>
                <select value={b.bell_type} onChange={e=>update(i,'bell_type',e.target.value)}
                  className="flex-1 p-2 bg-white rounded-xl border border-slate-200 text-sm font-bold">
                  {BELL_TYPES.map(t=><option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
                </select>
                <input value={b.label} onChange={e=>update(i,'label',e.target.value)}
                  className="flex-1 p-2 bg-white rounded-xl border border-slate-200 text-sm" placeholder="שם"/>
                <button onClick={()=>remove(i)} className="text-slate-300 hover:text-red-500 text-lg px-1">×</button>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={async()=>{ setImporting(true); await onImport(bells.map(b=>({...b,days}))); setImporting(false); }}
              disabled={importing || bells.length===0}
              className="flex-1 bg-violet-600 text-white py-4 rounded-[20px] font-black hover:bg-violet-700 transition disabled:opacity-40">
              {importing ? 'מייבא...' : `✅ ייבא ${bells.length} צלצולים`}
            </button>
            <button onClick={()=>setBells(null)} className="px-6 py-4 bg-slate-100 text-slate-400 rounded-[20px] font-black hover:bg-slate-200">חזור</button>
          </div>
        </>
      )}

      {!bells && !loading && (
        <button onClick={onClose} className="w-full mt-4 py-4 rounded-[20px] font-black text-slate-400 bg-slate-50">ביטול</button>
      )}
    </Modal>
  );
}

// ===== Hebrew Template Rule Form =====
function HebrewTemplateRuleForm({ templates, upcomingHolidays, onAdd }) {
  const [ruleType, setRuleType] = useState('holiday');
  const [templateId, setTemplateId] = useState('');
  const [holidayKey, setHolidayKey] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const uniqueHolidays = upcomingHolidays.filter((h, i, a) => a.findIndex(x => x.key === h.key) === i);

  const handleAdd = async () => {
    if (!templateId) return;
    const rule_value = ruleType === 'holiday' ? holidayKey : `${dateFrom}:${dateTo}`;
    if (!rule_value || rule_value === ':') return;
    setSaving(true);
    await onAdd({ template_id: templateId, rule_type: ruleType, rule_value, label: label || rule_value, auto_apply: 1 });
    setLabel(''); setHolidayKey(''); setDateFrom(''); setDateTo('');
    setSaving(false);
  };

  if (!templates.length) return <p className="text-slate-400 text-sm text-center">תחילה צור תבנית לוח שעות בלשונית "לוח שעות"</p>;

  return (
    <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
      <p className="text-sm font-bold text-slate-600">הוסף חוק חדש</p>
      <div className="flex gap-2">
        {[['holiday','🗓 חג'],['date_range','📆 טווח']].map(([v,l])=>(
          <button key={v} type="button" onClick={()=>setRuleType(v)}
            className={`flex-1 py-2.5 rounded-2xl text-sm font-bold transition ${ruleType===v?'bg-blue-600 text-white':'bg-white text-slate-500 border border-slate-200'}`}>{l}</button>
        ))}
      </div>
      <select value={templateId} onChange={e=>setTemplateId(e.target.value)}
        className="w-full p-3 bg-white rounded-2xl border border-slate-200 text-sm font-bold">
        <option value="">— בחר תבנית לוח שעות —</option>
        {templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {ruleType === 'holiday' ? (
        <select value={holidayKey} onChange={e=>{ setHolidayKey(e.target.value); if(!label) setLabel(e.target.options[e.target.selectedIndex].text); }}
          className="w-full p-3 bg-white rounded-2xl border border-slate-200 text-sm font-bold">
          <option value="">— בחר חג —</option>
          {uniqueHolidays.map(h=><option key={h.key} value={h.key}>{h.he||h.desc} ({h.date})</option>)}
        </select>
      ) : (
        <div className="flex gap-2">
          <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} className="flex-1 p-3 bg-white rounded-2xl border border-slate-200 text-sm"/>
          <span className="self-center text-slate-400">עד</span>
          <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} className="flex-1 p-3 bg-white rounded-2xl border border-slate-200 text-sm"/>
        </div>
      )}
      <input value={label} onChange={e=>setLabel(e.target.value)} placeholder="שם החוק (לדוגמה: לוח חנוכה)"
        className="w-full p-3 bg-white rounded-2xl border border-slate-200 text-sm"/>
      <button onClick={handleAdd} disabled={saving||!templateId}
        className="w-full bg-blue-600 text-white py-3 rounded-2xl font-black text-sm hover:bg-blue-700 transition disabled:opacity-40">
        {saving?'שומר...':'+ הוסף חוק'}
      </button>
    </div>
  );
}

// ===== Modal: Bell =====
function BellModal({ bell, playlists = [], devices = [], sounds = [], presets = {}, onClose, onSave }) {
  const [form, setForm] = useState({
    label:          bell?.label||'',
    time:           bell?.time||'08:00',
    days:           bell?.days||'0,1,2,3,4,5',
    audio_type:     bell?.audio_type||'upload',
    local_path:     bell?.audio_source||'',
    volume:         bell?.volume||80,
    duration:       bell?.duration||0,
    bell_type:      bell?.bell_type||'custom',
    break_duration: bell?.break_duration||0,
    breakPreset:    null,
    playlist_id:           bell?.playlist_id||null,
    playlist_start_delay:  bell?.playlist_start_delay||0,
    playlist_end_offset:   bell?.playlist_end_offset||0,
    playlist_volume:       bell?.playlist_volume != null ? bell.playlist_volume : '',
    repeat_count:          bell?.repeat_count||1,
    output_device:         bell?.output_device||'',
    start_time:            bell?.start_time||0,
    file:                  null,
  });
  const [saving,  setSaving]  = useState(false);
  const [testing, setTesting] = useState(false);
  const [error,   setError]   = useState('');
  const [presetApplied, setPresetApplied] = useState(false);
  const [showRange, setShowRange] = useState(!!(bell?.start_time > 0));
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  // When bell_type changes for a NEW bell, auto-apply preset
  const handleBellTypeChange = (newType) => {
    set('bell_type', newType);
    if (!bell && presets[newType]) {
      const p = presets[newType];
      setForm(f => ({
        ...f,
        bell_type:    newType,
        volume:       p.volume ?? f.volume,
        duration:     p.duration ?? f.duration,
        repeat_count: p.repeat_count ?? f.repeat_count,
        output_device:p.output_device || f.output_device,
        local_path:   p.audio_source  || f.local_path,
        audio_type:   p.audio_source  ? 'library' : f.audio_type,
        start_time:   p.start_time    ?? f.start_time,
      }));
      setPresetApplied(true);
    }
  };

  // Compute waveform URL
  const waveformUrl = (() => {
    if (form.audio_type === 'library' || form.audio_type === 'local_path') {
      if (!form.local_path) return null;
      if (form.local_path.startsWith('uploads/')) return `/${form.local_path}`;
      return `/api/audio-stream?src=${encodeURIComponent(form.local_path)}`;
    }
    return null;
  })();

  const selectBreakPreset = (preset) => {
    set('breakPreset', preset.minutes === null ? 'manual' : preset.minutes);
    if (preset.minutes !== null) set('break_duration', preset.minutes);
  };

  const isBreak = form.bell_type === 'break_start';

  return (
    <Modal onClose={onClose}>
      <h2 className="text-2xl font-black mb-7">{bell?'עריכת צלצול':'הוספת צלצול'}</h2>
      {presetApplied && !bell && (
        <div className="bg-blue-50 text-blue-600 text-xs font-bold px-3 py-2 rounded-xl mb-4 flex items-center justify-between">
          🔖 הגדרות שמורות נטענו אוטומטית לסוג זה
          <button onClick={()=>setPresetApplied(false)} className="text-blue-300 hover:text-blue-600 ml-2">✕</button>
        </div>
      )}
      <div className="space-y-5">

        {/* Bell type */}
        <div>
          <label className="block text-sm font-bold text-slate-400 mb-2">סוג צלצול</label>
          <div className="grid grid-cols-3 gap-2">
            {BELL_TYPES.map(t => (
              <button key={t.value} type="button" onClick={()=>handleBellTypeChange(t.value)}
                className={`py-2.5 px-3 rounded-2xl font-bold text-xs transition-all flex flex-col items-center gap-1 ${form.bell_type===t.value?'bg-blue-600 text-white shadow-lg':'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>
                <span className="text-lg">{t.icon}</span>{t.label}
                {presets[t.value] && <span className="text-[9px] opacity-60">🔖</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Break duration — only when break_start */}
        {isBreak && (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
            <label className="block text-sm font-bold text-amber-700 mb-3">☕ משך ההפסקה</label>
            <div className="flex gap-2 mb-3">
              {BREAK_PRESETS.map(p => (
                <button key={p.label} type="button"
                  onClick={()=>selectBreakPreset(p)}
                  className={`flex-1 py-2.5 rounded-xl font-black text-xs transition-all ${
                    (p.minutes!==null && form.break_duration===p.minutes && form.breakPreset!=='manual') ||
                    (p.minutes===null && form.breakPreset==='manual')
                      ? 'bg-amber-500 text-white shadow-md'
                      : 'bg-white text-amber-600 border border-amber-200 hover:bg-amber-100'
                  }`}>
                  {p.label}{p.minutes ? ` (${p.minutes}′)` : ''}
                </button>
              ))}
            </div>
            {(form.breakPreset === 'manual' || (form.break_duration > 0 && !BREAK_PRESETS.find(p=>p.minutes===form.break_duration))) && (
              <input type="number" min="1" max="120" value={form.break_duration}
                onChange={e=>set('break_duration',parseInt(e.target.value)||0)}
                placeholder="דקות"
                className="w-full p-3 bg-white rounded-xl border border-amber-200 font-bold text-center text-lg focus:outline-none focus:ring-2 focus:ring-amber-400"/>
            )}
            {form.break_duration > 0 && form.time && (
              <div className="mt-2 bg-amber-100 rounded-xl px-3 py-2 text-xs text-amber-700 font-bold flex items-center gap-2">
                <span>⏰</span>
                <span>צלצול תחילת שיעור ייווצר אוטומטית ב-{minutesToTime(timeToMinutes(form.time)+form.break_duration)}</span>
              </div>
            )}
            {form.break_duration === 0 && (
              <p className="text-xs text-amber-500 mt-1">0 = יחושב אוטומטית מהצלצול הבא</p>
            )}
          </div>
        )}

        {isBreak && playlists.length > 0 && (
          <div className="space-y-3">
            <label className="block text-sm font-bold text-slate-400">🎵 פלייליסט להפסקה (אופציונלי)</label>
            <select value={form.playlist_id||''} onChange={e=>set('playlist_id',e.target.value||null)}
              className="w-full p-4 bg-amber-50 rounded-2xl border border-amber-200 font-bold focus:outline-none focus:ring-2 focus:ring-amber-400">
              <option value="">ללא פלייליסט</option>
              {playlists.map(pl => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
            </select>
            {form.playlist_id && (
              <div className="bg-amber-50 rounded-2xl p-4 space-y-3 border border-amber-100">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-amber-700 mb-1">השהיה לאחר הצלצול (שניות)</label>
                    <input type="number" min="0" max="60" value={form.playlist_start_delay}
                      onChange={e=>set('playlist_start_delay',parseInt(e.target.value)||0)}
                      className="w-full p-2.5 bg-white rounded-xl border border-amber-200 font-bold text-center focus:outline-none focus:ring-2 focus:ring-amber-400"/>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-amber-700 mb-1">עוצמה (ריק = גלובלי)</label>
                    <input type="number" min="0" max="100" value={form.playlist_volume}
                      onChange={e=>set('playlist_volume',e.target.value===''?'':parseInt(e.target.value))}
                      placeholder="כמו מסטר"
                      className="w-full p-2.5 bg-white rounded-xl border border-amber-200 font-bold text-center focus:outline-none focus:ring-2 focus:ring-amber-400"/>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-amber-700 mb-2">סיום ניגון</label>
                  <div className="flex gap-2">
                    <button type="button" onClick={()=>set('playlist_end_offset',0)}
                      className={`flex-1 py-2 rounded-xl font-bold text-xs ${form.playlist_end_offset===0?'bg-amber-500 text-white':'bg-white text-amber-600 border border-amber-200'}`}>
                      עם הצלצול הבא
                    </button>
                    <button type="button" onClick={()=>set('playlist_end_offset',form.playlist_end_offset||30)}
                      className={`flex-1 py-2 rounded-xl font-bold text-xs ${form.playlist_end_offset>0?'bg-amber-500 text-white':'bg-white text-amber-600 border border-amber-200'}`}>
                      לפני הצלצול
                    </button>
                  </div>
                  {form.playlist_end_offset > 0 && (
                    <div className="flex items-center gap-2 mt-2">
                      <input type="number" min="5" max="300" value={form.playlist_end_offset}
                        onChange={e=>set('playlist_end_offset',parseInt(e.target.value)||30)}
                        className="w-20 p-2 bg-white rounded-xl border border-amber-200 font-bold text-center text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"/>
                      <span className="text-xs text-amber-600 font-bold">שניות לפני הצלצול הבא</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div><label className="block text-sm font-bold text-slate-400 mb-2">שם</label>
          <input value={form.label} onChange={e=>set('label',e.target.value)} placeholder="הפסקה גדולה"
            className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"/></div>
        <div><label className="block text-sm font-bold text-slate-400 mb-2">שעה</label>
          <input type="time" value={form.time} onChange={e=>set('time',e.target.value)}
            className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-bold text-xl focus:outline-none focus:ring-2 focus:ring-blue-500"/></div>
        <div><label className="block text-sm font-bold text-slate-400 mb-2">ימים</label>
          <DaySelector value={form.days} onChange={v=>set('days',v)}/></div>
        <div><label className="block text-sm font-bold text-slate-400 mb-2">עוצמה: {form.volume}%</label>
          <input type="range" min="0" max="100" value={form.volume} onChange={e=>set('volume',parseInt(e.target.value))}
            className="w-full h-3 bg-slate-100 rounded-full appearance-none cursor-pointer accent-blue-600"/></div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-bold text-slate-400">
              משך ניגון: {form.duration > 0 ? `${form.duration} שניות` : 'קובץ מלא'}
            </label>
            <button type="button" onClick={()=>setShowRange(r=>!r)}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition ${showRange ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
              ✂️ טווח
            </button>
          </div>
          <input type="number" min="0" max="600" value={form.duration} onChange={e=>set('duration',parseInt(e.target.value)||0)}
            placeholder="0"
            className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-bold text-center text-xl focus:outline-none focus:ring-2 focus:ring-blue-500"/>
          <p className="text-xs text-slate-300 mt-1">0 = ינגן את כל הקובץ</p>

          {showRange && (
            <div className="mt-3 bg-blue-50 rounded-2xl p-4 space-y-3">
              <label className="block text-sm font-bold text-blue-700">
                ▶ נקודת התחלה: {form.start_time > 0 ? `${form.start_time} שניות` : 'מהתחלה'}
              </label>
              <div className="flex gap-2">
                <input type="number" min="0" max="3600" step="0.5" value={form.start_time}
                  onChange={e=>set('start_time',parseFloat(e.target.value)||0)}
                  className="flex-1 p-3 bg-white rounded-2xl border border-blue-200 font-bold text-center text-lg focus:outline-none focus:ring-2 focus:ring-blue-500"/>
                {bell?.id && (testing ? (
                  <button type="button"
                    onClick={()=>api('/api/player/stop',{method:'POST'}).then(()=>{setTesting(false);notify('הופסק')})}
                    className="px-4 bg-rose-500 text-white rounded-2xl font-bold hover:bg-rose-600 text-sm flex-shrink-0 animate-pulse">
                    ⏹ עצור
                  </button>
                ) : (
                  <button type="button"
                    onClick={()=>api(`/api/bells/play/${bell.id}?start=${form.start_time}&dur=${form.duration>0?form.duration:5}`,{method:'POST'}).then(()=>{setTesting(true);notify('▶ מנגן מנקודה זו')}).catch(e=>notify(e.message,'error'))}
                    className="px-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 text-sm flex-shrink-0">
                    ▶ בדוק
                  </button>
                ))}
              </div>
              <AudioWaveform audioUrl={waveformUrl} startTime={form.start_time} duration={form.duration} onChange={v=>set('start_time',v)}/>
              <p className="text-xs text-blue-400">לחץ על הגל לבחירת נקודת התחלה · אזור כחול = מה שישמע</p>
            </div>
          )}
        </div>
        <div>
          <label className="block text-sm font-bold text-slate-400 mb-2">חזרות: {form.repeat_count}×</label>
          <input type="range" min="1" max="5" value={form.repeat_count} onChange={e=>set('repeat_count',parseInt(e.target.value))}
            className="w-full h-3 bg-slate-100 rounded-full appearance-none cursor-pointer accent-blue-600"/>
          {form.repeat_count > 1 && <p className="text-xs text-blue-500 mt-1">הצלצול ישמע {form.repeat_count} פעמים עם 0.6 שניות בין חזרה</p>}
        </div>
        {devices.length > 1 && (
          <div>
            <label className="block text-sm font-bold text-slate-400 mb-2">🔊 אזור הגברה</label>
            <select value={form.output_device||''} onChange={e=>set('output_device',e.target.value||'')}
              className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">ברירת מחדל (גלובלי)</option>
              {devices.map(d=><option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="block text-sm font-bold text-slate-400 mb-2">קובץ שמע</label>
          {bell?.audio_source && (
            <div className="bg-slate-50 rounded-xl px-3 py-2 mb-2 text-xs font-mono text-slate-500 truncate">
              ▶ נוכחי: {bell.audio_source.split(/[/\\]/).pop()}
            </div>
          )}
          <div className="flex gap-2 mb-3">
            {[['library','🎵 ספרייה'],['upload','📁 העלאה'],['local_path','💾 נתיב']].map(([v,l])=>(
              <button key={v} type="button" onClick={()=>set('audio_type',v)}
                className={`flex-1 py-2.5 rounded-2xl font-bold text-xs transition-all ${form.audio_type===v?'bg-blue-600 text-white':'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>{l}</button>
            ))}
          </div>
          {form.audio_type==='library'
            ? <div className="space-y-2">
                <select value={form.local_path} onChange={e=>set('local_path',e.target.value)}
                  className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— בחר מנגינה —</option>
                  {sounds.map(s=><option key={s.name} value={s.path}>{s.name}</option>)}
                </select>
                {form.local_path && (
                  <button type="button" onClick={()=>{ const a=new Audio('/'+form.local_path); a.play(); }}
                    className="w-full bg-slate-100 text-slate-600 py-2.5 rounded-2xl text-sm font-bold hover:bg-blue-50 hover:text-blue-700 transition">
                    ▶ נגן תצוגה מקדימה
                  </button>
                )}
              </div>
            : form.audio_type==='upload'
            ? <input type="file" accept=".mp3,.wav,.ogg,.aac,.flac,.m4a" onChange={e=>set('file',e.target.files[0])}
                className="w-full p-4 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 text-sm text-slate-400"/>
            : <input value={form.local_path} onChange={e=>set('local_path',e.target.value)} placeholder="C:\Music\bell.mp3"
                className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
          }
        </div>
        {error && <div className="bg-rose-50 text-rose-600 p-4 rounded-2xl text-sm font-bold">{error}</div>}
      </div>
      <div className="flex gap-3 mt-7">
        <button onClick={async()=>{if(!form.label){setError('חובה שם');return;}setSaving(true);try{await onSave(form);}catch(e){setError(e.message);setSaving(false);}}}
          disabled={saving} className="flex-1 bg-blue-600 text-white py-4 rounded-[20px] font-black hover:bg-blue-700 transition disabled:opacity-50">
          {saving?'שומר...':bell?'שמור':'הוסף'}
        </button>
        <button onClick={onClose} className="px-8 py-4 rounded-[20px] font-black text-slate-400 bg-slate-50 hover:bg-slate-100">ביטול</button>
      </div>
    </Modal>
  );
}

// ===== Modal: Copy Day =====
function CopyDayModal({ initialFromDay, onClose, onCopy }) {
  const [fromDay, setFromDay] = useState(initialFromDay);
  const [toDay,   setToDay]   = useState((initialFromDay + 1) % 6);
  const [saving,  setSaving]  = useState(false);

  return (
    <Modal onClose={onClose}>
      <h2 className="text-2xl font-black mb-2">📋 העתק לוח שעות יומי</h2>
      <p className="text-slate-400 text-sm mb-7">
        כל הצלצולים של יום המקור יועתקו כרשומות עצמאיות ליום היעד.
      </p>
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-bold text-slate-400 mb-3">יום מקור</label>
          <div className="flex gap-2 flex-wrap">
            {DAY_NAMES.map((name,i) => (
              <button key={i} type="button" onClick={()=>setFromDay(i)}
                className={`flex-1 min-w-[72px] py-3 rounded-2xl font-bold text-sm transition-all ${fromDay===i?'bg-violet-600 text-white shadow-lg':'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>
                {name}
              </button>
            ))}
          </div>
        </div>
        <div className="text-center text-2xl text-slate-300">↓</div>
        <div>
          <label className="block text-sm font-bold text-slate-400 mb-3">יום יעד</label>
          <div className="flex gap-2 flex-wrap">
            {DAY_NAMES.map((name,i) => (
              <button key={i} type="button" onClick={()=>setToDay(i)}
                disabled={i===fromDay}
                className={`flex-1 min-w-[72px] py-3 rounded-2xl font-bold text-sm transition-all ${toDay===i&&i!==fromDay?'bg-blue-600 text-white shadow-lg':'i===fromDay?bg-slate-100 text-slate-300 cursor-not-allowed:bg-slate-50 text-slate-500 hover:bg-slate-100'} ${i===fromDay?'opacity-30 cursor-not-allowed':''}`}>
                {name}
              </button>
            ))}
          </div>
        </div>
        {fromDay !== toDay && (
          <div className="bg-violet-50 rounded-2xl p-4 text-sm text-violet-700 font-bold">
            📅 יום {DAY_NAMES[fromDay]} → יום {DAY_NAMES[toDay]}
          </div>
        )}
      </div>
      <div className="flex gap-3 mt-7">
        <button
          onClick={async()=>{setSaving(true);try{await onCopy({fromDay,toDay});}finally{setSaving(false);}}}
          disabled={saving||fromDay===toDay}
          className="flex-1 bg-violet-600 text-white py-4 rounded-[20px] font-black hover:bg-violet-700 transition disabled:opacity-40">
          {saving?'מעתיק...':'העתק'}
        </button>
        <button onClick={onClose} className="px-8 py-4 rounded-[20px] font-black text-slate-400 bg-slate-50">ביטול</button>
      </div>
    </Modal>
  );
}

// ===== Modal: Vacation =====
const HEB_MONTHS_LIST = ['ניסן','אייר','סיון','תמוז','אב','אלול','תשרי','חשון','כסלו','טבת','שבט','אדר',"אדר ב'"];
const HEB_MONTH_TO_NUM = {'ניסן':1,'אייר':2,'סיון':3,'תמוז':4,'אב':5,'אלול':6,'תשרי':7,'חשון':8,'כסלו':9,'טבת':10,'שבט':11,'אדר':12,"אדר ב'":13};

function HebDatePicker({ value, onChange }) {
  const [day, setDay]     = useState(value?.day   || 1);
  const [month, setMonth] = useState(value?.month || 7);
  const [year, setYear]   = useState(value?.year  || '');
  const notify2 = (d, m, y) => onChange({ day: d, month: m, year: y || null });
  return (
    <div className="flex gap-2">
      <select value={day} onChange={e=>{ const d=parseInt(e.target.value); setDay(d); notify2(d,month,year); }}
        className="flex-shrink-0 p-3 bg-slate-50 rounded-2xl border border-slate-200 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm w-16">
        {Array.from({length:30},(_,i)=>i+1).map(d=><option key={d} value={d}>{d}</option>)}
      </select>
      <select value={month} onChange={e=>{ const m=parseInt(e.target.value); setMonth(m); notify2(day,m,year); }}
        className="flex-1 p-3 bg-slate-50 rounded-2xl border border-slate-200 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
        {HEB_MONTHS_LIST.map(m=><option key={m} value={HEB_MONTH_TO_NUM[m]}>{m}</option>)}
      </select>
      <input type="number" value={year} onChange={e=>{ const y=e.target.value; setYear(y); notify2(day,month,y); }} placeholder="שנה"
        className="w-24 p-3 bg-slate-50 rounded-2xl border border-slate-200 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        min="5780" max="5900"/>
    </div>
  );
}

function VacationModal({ onClose, onSave }) {
  const [mode,    setMode]    = useState('single'); // single | range
  const [dateType,setDateType]= useState('greg');   // greg | heb
  const [date,    setDate]    = useState('');
  const [dateFrom,setDateFrom]= useState('');
  const [dateTo,  setDateTo]  = useState('');
  const [hebDate, setHebDate] = useState({ day:1, month:7, year:'' });
  const [hebFrom, setHebFrom] = useState({ day:1, month:7, year:'' });
  const [hebTo,   setHebTo]   = useState({ day:1, month:7, year:'' });
  const [label,   setLabel]   = useState('');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  const expandGregRange = (from, to) => {
    const dates = []; let cur = new Date(from); const end = new Date(to);
    while (cur <= end && dates.length < 366) { dates.push(cur.toISOString().split('T')[0]); cur.setDate(cur.getDate()+1); }
    return dates;
  };

  const handleSave = async () => {
    setError(''); setSaving(true);
    try {
      let dates = [];
      if (dateType === 'greg') {
        if (mode === 'single') {
          if (!date) { setError('בחר תאריך'); setSaving(false); return; }
          dates = [date];
        } else {
          if (!dateFrom || !dateTo || dateFrom > dateTo) { setError('בחר טווח תאריכים תקין'); setSaving(false); return; }
          dates = expandGregRange(dateFrom, dateTo);
        }
      } else {
        if (mode === 'single') {
          const r = await api('/api/hebrew/convert', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ date: hebDate }) });
          if (!r.iso) { setError('תאריך עברי לא תקין'); setSaving(false); return; }
          dates = [r.iso];
        } else {
          const r = await api('/api/hebrew/convert', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ from: hebFrom, to: hebTo }) });
          if (!r.from) { setError('טווח עברי לא תקין'); setSaving(false); return; }
          dates = r.days || [];
        }
      }
      if (!dates.length) { setError('לא נבחרו תאריכים'); setSaving(false); return; }
      await onSave({ dates, label });
    } catch(e) { setError(e.message); setSaving(false); }
  };

  return (
    <Modal onClose={onClose}>
      <h2 className="text-2xl font-black mb-5">הוספת חופשה</h2>

      {/* Mode + type toggles */}
      <div className="flex gap-2 mb-4">
        {[['single','יום בודד'],['range','טווח תאריכים']].map(([v,l])=>(
          <button key={v} type="button" onClick={()=>setMode(v)}
            className={`flex-1 py-3 rounded-2xl font-bold text-sm transition-all ${mode===v?'bg-blue-600 text-white':'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>{l}</button>
        ))}
      </div>
      <div className="flex gap-2 mb-5">
        {[['greg','לועזי'],['heb','עברי']].map(([v,l])=>(
          <button key={v} type="button" onClick={()=>setDateType(v)}
            className={`flex-1 py-2.5 rounded-2xl font-bold text-sm transition-all ${dateType===v?'bg-slate-700 text-white':'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>{l}</button>
        ))}
      </div>

      <div className="space-y-4">
        {/* Date input */}
        {dateType==='greg' && mode==='single' && (
          <div>
            <label className="block text-sm font-bold text-slate-400 mb-2">תאריך</label>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)}
              className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"/>
          </div>
        )}
        {dateType==='greg' && mode==='range' && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-bold text-slate-400 mb-2">מתאריך</label>
              <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}
                className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"/>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-400 mb-2">עד תאריך</label>
              <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}
                className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"/>
            </div>
            {dateFrom && dateTo && dateFrom <= dateTo && (
              <div className="text-xs text-emerald-600 font-bold text-center">
                {expandGregRange(dateFrom, dateTo).length} ימים
              </div>
            )}
          </div>
        )}
        {dateType==='heb' && mode==='single' && (
          <div>
            <label className="block text-sm font-bold text-slate-400 mb-2">תאריך עברי</label>
            <HebDatePicker value={hebDate} onChange={setHebDate}/>
          </div>
        )}
        {dateType==='heb' && mode==='range' && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-bold text-slate-400 mb-2">מ</label>
              <HebDatePicker value={hebFrom} onChange={setHebFrom}/>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-400 mb-2">עד</label>
              <HebDatePicker value={hebTo} onChange={setHebTo}/>
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-bold text-slate-400 mb-2">שם (אופציונלי)</label>
          <input value={label} onChange={e=>setLabel(e.target.value)} placeholder="חנוכה, פסח..."
            className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"/>
        </div>

        {error && <div className="bg-rose-50 text-rose-600 p-3 rounded-2xl text-sm font-bold">{error}</div>}
      </div>

      <div className="flex gap-3 mt-6">
        <button onClick={handleSave} disabled={saving}
          className="flex-1 bg-emerald-600 text-white py-4 rounded-[20px] font-black hover:bg-emerald-700 transition disabled:opacity-40">
          {saving ? 'שומר...' : 'הוסף'}
        </button>
        <button onClick={onClose} className="px-8 py-4 rounded-[20px] font-black text-slate-400 bg-slate-50">ביטול</button>
      </div>
    </Modal>
  );
}

// ===== Modal: Import from Excel/PDF =====
function ImportFileModal({ onClose, onImport }) {
  const [file,       setFile]       = useState(null);
  const [dates,      setDates]      = useState([]);
  const [selected,   setSelected]   = useState(new Set());
  const [loading,    setLoading]    = useState(false);
  const [importing,  setImporting]  = useState(false);
  const [error,      setError]      = useState('');

  const loadFile = async () => {
    if (!file) return;
    setLoading(true); setError(''); setDates([]); setSelected(new Set());
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/api/vacations/import', { method:'POST', body: fd });
      const data = await res.json().catch(() => { throw new Error(`שגיאת שרת (${res.status})`); });
      if (!res.ok) throw new Error(data.error);
      setDates(data.dates||[]);
      setSelected(new Set(data.dates.map(d=>d.date)));
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const toggle = date => setSelected(s => { const n=new Set(s); n.has(date)?n.delete(date):n.add(date); return n; });

  return (
    <Modal onClose={onClose} wide>
      <h2 className="text-2xl font-black mb-2">📊 ייבוא חופשות מ-Excel</h2>
      <p className="text-slate-400 text-sm mb-6">תומך ב-Excel (xlsx / xls / csv)</p>

      <div className="space-y-3 mb-5">
        <input type="file" accept=".xlsx,.xls,.csv"
          onChange={e=>{ setFile(e.target.files[0]); setDates([]); setSelected(new Set()); setError(''); }}
          className="w-full p-4 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 text-sm text-slate-500"/>
        <button onClick={loadFile} disabled={!file||loading}
          className="w-full bg-violet-600 text-white py-3.5 rounded-2xl font-black hover:bg-violet-700 transition disabled:opacity-50">
          {loading ? 'מנתח קובץ...' : '🔍 נתח קובץ'}
        </button>
      </div>

      {error && <div className="bg-rose-50 text-rose-600 p-4 rounded-2xl text-sm font-bold mb-4">{error}</div>}

      {dates.length > 0 && (
        <>
          <div className="flex justify-between items-center mb-3">
            <span className="text-slate-400 text-sm font-bold">נמצאו {dates.length} תאריכים · {selected.size} נבחרו</span>
            <div className="flex gap-3">
              <button onClick={()=>setSelected(new Set(dates.map(d=>d.date)))} className="text-violet-600 font-bold text-sm">בחר הכל</button>
              <button onClick={()=>setSelected(new Set())} className="text-slate-400 font-bold text-sm">נקה הכל</button>
            </div>
          </div>
          <div className="space-y-1.5 max-h-56 overflow-y-auto mb-5 border border-slate-100 rounded-2xl p-3">
            {dates.map(h=>(
              <label key={h.date} className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" checked={selected.has(h.date)} onChange={()=>toggle(h.date)} className="w-5 h-5 accent-violet-600"/>
                <span className="font-bold text-sm tabular-nums flex-1">{h.date}</span>
                {h.label && <span className="text-slate-400 text-xs">{h.label}</span>}
              </label>
            ))}
          </div>
          <button
            onClick={async()=>{if(!selected.size)return;setImporting(true);try{await onImport(dates.filter(d=>selected.has(d.date)));}finally{setImporting(false);}}}
            disabled={!selected.size||importing}
            className="w-full bg-emerald-600 text-white py-4 rounded-[20px] font-black hover:bg-emerald-700 transition disabled:opacity-50">
            {importing ? 'מייבא...' : `ייבא ${selected.size} ימים`}
          </button>
        </>
      )}

      <button onClick={onClose} className="w-full mt-3 py-4 rounded-[20px] font-black text-slate-400 bg-slate-50">ביטול</button>
    </Modal>
  );
}

// ===== Modal: Holiday Import (Hebcal) =====
// ===== Modal: iCal Import =====
function ICalImportModal({ onClose, onImport }) {
  const [url,     setUrl]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const PRESETS = [
    { label: 'משרד החינוך – חופשות תשפ"ו', url: 'https://www.gov.il/he/departments/ministry_of_education/subjects/school_calendar' },
  ];

  const doImport = async () => {
    if (!url) { setError('הכנס כתובת URL של יומן iCal'); return; }
    setLoading(true); setError('');
    try {
      const d = await api('/api/vacations/import-ical', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url }) });
      await onImport(d.count);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <Modal onClose={onClose} wide>
      <h2 className="text-2xl font-black mb-2">📅 ייבוא מיומן Google / iCal</h2>
      <p className="text-slate-400 text-sm mb-5">הדבק קישור לקובץ .ics (Google Calendar, Outlook, מש"ח וכו')</p>

      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 mb-5 text-sm text-blue-700">
        <strong>איך מקבלים קישור iCal מ-Google?</strong><br/>
        Google Calendar ← לחץ ☰ ← הגדרות ← שם היומן ← שילוב יומן ← כתובת iCal
      </div>

      <div className="space-y-3 mb-5">
        <input value={url} onChange={e=>setUrl(e.target.value)}
          placeholder="https://calendar.google.com/calendar/ical/..."
          className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"/>
        <div className="flex gap-2 flex-wrap">
          {PRESETS.map(p=>(
            <button key={p.label} type="button" onClick={()=>setUrl(p.url)}
              className="text-xs bg-slate-100 text-slate-600 px-3 py-1.5 rounded-xl font-bold hover:bg-slate-200">
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="bg-rose-50 text-rose-600 p-4 rounded-2xl text-sm font-bold mb-4">{error}</div>}

      <div className="flex gap-3">
        <button onClick={doImport} disabled={!url||loading}
          className="flex-1 bg-emerald-600 text-white py-4 rounded-[20px] font-black hover:bg-emerald-700 transition disabled:opacity-50">
          {loading?'מייבא...':'📥 ייבא חופשות'}
        </button>
        <button onClick={onClose} className="px-8 py-4 rounded-[20px] font-black text-slate-400 bg-slate-50">ביטול</button>
      </div>
    </Modal>
  );
}

// ===== Modal: Day Override =====
function DayOverrideModal({ onClose, onSave }) {
  const [date,    setDate]    = useState('');
  const [fromDay, setFromDay] = useState(0);
  const [label,   setLabel]   = useState('');
  const [saving,  setSaving]  = useState(false);

  return (
    <Modal onClose={onClose}>
      <h2 className="text-2xl font-black mb-2">📆 יום חריג</h2>
      <p className="text-slate-400 text-sm mb-6">בתאריך זה תפעל מערכת השעות כשל יום אחר בשבוע</p>
      <div className="space-y-5">
        <div>
          <label className="block text-sm font-bold text-slate-400 mb-2">תאריך</label>
          <input type="date" value={date} onChange={e=>setDate(e.target.value)}
            className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"/>
        </div>
        <div>
          <label className="block text-sm font-bold text-slate-400 mb-2">השתמש במערכת של יום</label>
          <div className="grid grid-cols-3 gap-2">
            {DAY_NAMES.map((name,i)=>(
              <button key={i} type="button" onClick={()=>setFromDay(i)}
                className={`py-3 rounded-2xl font-bold text-sm transition-all ${fromDay===i?'bg-blue-600 text-white shadow-lg':'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>
                {name}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-sm font-bold text-slate-400 mb-2">הערה (אופציונלי)</label>
          <input value={label} onChange={e=>setLabel(e.target.value)} placeholder="אירוע מיוחד, טיול..."
            className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"/>
        </div>
      </div>
      <div className="flex gap-3 mt-7">
        <button onClick={async()=>{if(!date)return;setSaving(true);try{await onSave({date,from_day:fromDay,label});}finally{setSaving(false);}}}
          disabled={!date||saving}
          className="flex-1 bg-blue-600 text-white py-4 rounded-[20px] font-black hover:bg-blue-700 transition disabled:opacity-40">
          {saving?'שומר...':'שמור'}
        </button>
        <button onClick={onClose} className="px-8 py-4 rounded-[20px] font-black text-slate-400 bg-slate-50">ביטול</button>
      </div>
    </Modal>
  );
}

// ===== Mobile Home Screen =====
function MobileHome({ data, announceActive, emergencyActive, emergency, playerStatus, onAnnounce, onScheduledPlay, onEmergency, silentMode, onSilent, onFullMode, modals }) {
  const status    = computeCurrentStatus(data.bells);
  const schoolName = data.settings.school_name || 'בית הספר';
  const stateLabel = {
    before_school: { text:'לפני תחילת הלימודים', color:'slate',  icon:'🌅' },
    lesson:        { text:'בשיעור',               color:'blue',   icon:'📚' },
    break:         { text:'הפסקה',                color:'amber',  icon:'☕' },
    after_school:  { text:'סיום הלימודים',        color:'violet', icon:'🌇' },
  }[status.state] || { text:'—', color:'slate', icon:'🔔' };
  const colorMap = {
    blue:  'bg-blue-600',  amber: 'bg-amber-500',
    slate: 'bg-slate-600', violet:'bg-violet-600',
  };
  const bg = colorMap[stateLabel.color] || 'bg-slate-600';

  return (
    <div dir="rtl" className="h-screen bg-slate-50 flex flex-col p-5 overflow-y-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-5">
        <div>
          <div className="flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 28 28" fill="none"><circle cx="14" cy="14" r="14" fill="#2563eb"/><path d="M14 5C10.7 5 8 7.7 8 11v5l-1.5 2h15L20 16v-5c0-3.3-2.7-6-6-6z" fill="white"/><circle cx="14" cy="23" r="2" fill="white"/><rect x="11" y="21" width="6" height="2" rx="1" fill="white"/></svg>
            <span className="font-black text-blue-600 text-lg">צלצולי</span>
          </div>
          <div className="text-xs text-slate-400 mt-0.5">{schoolName}</div>
        </div>
        <div className="text-2xl font-black tabular-nums text-slate-800">{data.time}</div>
      </div>

      {/* Status card */}
      <div className={`${bg} rounded-[28px] p-6 text-white mb-4 shadow-xl`}>
        <div className="text-4xl mb-2">{stateLabel.icon}</div>
        <div className="text-2xl font-black">{stateLabel.text}</div>
        {status.state==='break' && status.breakEndsAt && (
          <div className="opacity-80 text-sm mt-1">הפסקה עד {status.breakEndsAt}</div>
        )}
        {status.nextBell && (
          <div className="mt-4 bg-white/20 rounded-2xl p-3">
            <div className="text-xs opacity-80 mb-0.5">הצלצול הבא</div>
            <div className="text-xl font-black">{status.nextBell.time}</div>
            <div className="opacity-90 text-sm">{status.nextBell.label}</div>
            <div className="text-xs opacity-70 mt-1">
              בעוד {status.minutesUntilNext >= 60
                ? `${Math.floor(status.minutesUntilNext/60)}ש׳ ${status.minutesUntilNext%60}ד׳`
                : `${status.minutesUntilNext} דקות`}
            </div>
          </div>
        )}
      </div>

      {playerStatus.playing && (
        <div className="bg-white rounded-2xl p-4 mb-4 flex items-center gap-3 shadow-sm">
          <span className="text-blue-600 text-xl">🎵</span>
          <div className="flex-1 min-w-0">
            <div className="font-black text-sm truncate">{playerStatus.currentSong}</div>
            <div className="text-slate-400 text-xs">{playerStatus.songIndex+1}/{playerStatus.totalSongs}</div>
          </div>
        </div>
      )}

      {(announceActive || emergencyActive) && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 mb-4 flex items-center gap-3">
          <span className="text-xl animate-pulse">{emergencyActive?'🚨':'📢'}</span>
          <span className="font-black text-rose-700 text-sm flex-1">{emergencyActive?'חירום פעיל!':'כריזה פעילה'}</span>
          {emergencyActive && (
            <button onClick={()=>doAction(()=>api('/api/player/stop',{method:'POST'}).then(()=>notify('הופסק')))}
              className="bg-rose-600 text-white px-4 py-1.5 rounded-xl font-bold text-xs hover:bg-rose-700 transition flex-shrink-0">
              ⏹ עצור
            </button>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <button onClick={()=>window.location.href='/announce'}
          className="bg-blue-600 text-white py-6 rounded-[24px] font-black shadow-xl shadow-blue-100 active:scale-95 transition flex flex-col items-center gap-2">
          <span className="text-3xl">📢</span>
          כריזה חיה
        </button>
        <button onClick={onScheduledPlay}
          className="bg-emerald-600 text-white py-6 rounded-[24px] font-black shadow-xl shadow-emerald-100 active:scale-95 transition flex flex-col items-center gap-2">
          <span className="text-3xl">💬</span>
          השאר הודעה
        </button>
      </div>

      {/* Silent mode strip */}
      {silentMode?.active ? (
        <button onClick={()=>onSilent(0)}
          className="w-full mb-3 bg-slate-800 text-white py-2.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 animate-pulse">
          🔇 שקט עוד {silentMode.minutesLeft} דקות — לחץ לביטול
        </button>
      ) : (
        <div className="flex gap-2 mb-3">
          {[30,60,120].map(m=>(
            <button key={m} onClick={()=>onSilent(m)}
              className="flex-1 bg-slate-100 text-slate-600 py-2 rounded-2xl font-bold text-xs active:scale-95 transition">
              🔇 {m}′
            </button>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex justify-between items-center mt-2">
        <button onClick={onEmergency}
          className={`px-4 py-2.5 rounded-2xl font-bold text-sm flex items-center gap-2 ${emergencyActive?'bg-rose-600 text-white animate-pulse':'bg-rose-100 text-rose-600'}`}>
          🚨 חירום
        </button>
        <button onClick={onFullMode}
          className="text-blue-600 text-sm font-black flex items-center gap-1 bg-blue-50 px-4 py-2.5 rounded-2xl">
          ניהול מלא ←
        </button>
      </div>

      {modals}
    </div>
  );
}

// ===== Modal: Playlist =====
function PlaylistModal({ playlist, onClose, onSave }) {
  const [name,    setName]   = useState(playlist?.name||'');
  const [shuffle, setShuffle] = useState(!!playlist?.shuffle);
  const [repeat,  setRepeat]  = useState(playlist?.repeat_mode??1);
  const [saving,  setSaving]  = useState(false);
  return (
    <Modal onClose={onClose}>
      <h2 className="text-2xl font-black mb-7">{playlist?'עריכת פלייליסט':'פלייליסט חדש'}</h2>
      <div className="space-y-5">
        <div><label className="block text-sm font-bold text-slate-400 mb-2">שם הפלייליסט</label>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="שירי הפסקה"
            className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"/></div>
        <div className="flex gap-4">
          <label className="flex items-center gap-3 cursor-pointer bg-slate-50 rounded-2xl p-4 flex-1">
            <input type="checkbox" checked={shuffle} onChange={e=>setShuffle(e.target.checked)} className="w-5 h-5 accent-blue-600"/>
            <div><div className="font-bold">שאפל</div><div className="text-slate-400 text-xs">סדר אקראי</div></div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer bg-slate-50 rounded-2xl p-4 flex-1">
            <input type="checkbox" checked={!!repeat} onChange={e=>setRepeat(e.target.checked?1:0)} className="w-5 h-5 accent-blue-600"/>
            <div><div className="font-bold">חזרה</div><div className="text-slate-400 text-xs">חזור מההתחלה</div></div>
          </label>
        </div>
      </div>
      <div className="flex gap-3 mt-7">
        <button onClick={async()=>{if(!name)return;setSaving(true);try{await onSave({name,shuffle,repeat_mode:repeat});}finally{setSaving(false);}}}
          disabled={!name||saving} className="flex-1 bg-blue-600 text-white py-4 rounded-[20px] font-black hover:bg-blue-700 transition disabled:opacity-50">
          {saving?'שומר...':playlist?'שמור':'צור'}
        </button>
        <button onClick={onClose} className="px-8 py-4 rounded-[20px] font-black text-slate-400 bg-slate-50">ביטול</button>
      </div>
    </Modal>
  );
}

// ===== Modal: Add Song =====
function AddSongModal({ onClose, onSave }) {
  const [form,setForm]=useState({name:'',audio_type:'upload',local_path:'',file:null});
  const [saving,setSaving]=useState(false);const[error,setError]=useState('');
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  return (
    <Modal onClose={onClose}>
      <h2 className="text-2xl font-black mb-7">הוספת שיר</h2>
      <div className="space-y-5">
        <div><label className="block text-sm font-bold text-slate-400 mb-2">שם השיר</label>
          <input value={form.name} onChange={e=>set('name',e.target.value)} placeholder="ישאר כשם הקובץ אם ריק"
            className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"/></div>
        <div>
          <label className="block text-sm font-bold text-slate-400 mb-2">קובץ</label>
          <div className="flex gap-2 mb-3">
            {[['upload','📁 העלאה'],['local_path','💾 נתיב']].map(([v,l])=>(
              <button key={v} type="button" onClick={()=>set('audio_type',v)}
                className={`flex-1 py-3 rounded-2xl font-bold text-sm transition-all ${form.audio_type===v?'bg-blue-600 text-white':'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>{l}</button>
            ))}
          </div>
          {form.audio_type==='upload'
            ?<input type="file" accept=".mp3,.wav,.ogg,.aac,.flac,.m4a" onChange={e=>set('file',e.target.files[0])}
                className="w-full p-4 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 text-sm text-slate-400"/>
            :<input value={form.local_path} onChange={e=>set('local_path',e.target.value)} placeholder="C:\Music\song.mp3"
                className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
          }
        </div>
        {error && <div className="bg-rose-50 text-rose-600 p-4 rounded-2xl text-sm font-bold">{error}</div>}
      </div>
      <div className="flex gap-3 mt-7">
        <button onClick={async()=>{setSaving(true);try{await onSave(form);}catch(e){setError(e.message);setSaving(false);}}}
          disabled={saving} className="flex-1 bg-blue-600 text-white py-4 rounded-[20px] font-black hover:bg-blue-700 transition disabled:opacity-50">
          {saving?'מוסיף...':'הוסף שיר'}
        </button>
        <button onClick={onClose} className="px-8 py-4 rounded-[20px] font-black text-slate-400 bg-slate-50">ביטול</button>
      </div>
    </Modal>
  );
}

// ===== Modal: Add Emergency =====
function AddEmergencyModal({ onClose, onSave }) {
  const [form,setForm]=useState({label:'',audio_type:'upload',local_path:'',file:null});
  const [saving,setSaving]=useState(false);const[error,setError]=useState('');
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  return (
    <Modal onClose={onClose}>
      <h2 className="text-2xl font-black mb-2">🚨 הוספת הודעת חירום</h2>
      <p className="text-slate-400 text-sm mb-7">הודעה זו תנגן בעוצמה מקסימלית בלחיצה אחת</p>
      <div className="space-y-5">
        <div><label className="block text-sm font-bold text-slate-400 mb-2">שם ההודעה</label>
          <input value={form.label} onChange={e=>set('label',e.target.value)} placeholder="פינוי מיידי / אש / הכרזה"
            className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"/></div>
        <div>
          <label className="block text-sm font-bold text-slate-400 mb-2">קובץ שמע</label>
          <div className="flex gap-2 mb-3">
            {[['upload','📁 העלאה'],['local_path','💾 נתיב']].map(([v,l])=>(
              <button key={v} type="button" onClick={()=>set('audio_type',v)}
                className={`flex-1 py-3 rounded-2xl font-bold text-sm transition-all ${form.audio_type===v?'bg-rose-600 text-white':'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>{l}</button>
            ))}
          </div>
          {form.audio_type==='upload'
            ?<input type="file" accept=".mp3,.wav,.ogg,.aac,.flac,.m4a" onChange={e=>set('file',e.target.files[0])}
                className="w-full p-4 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 text-sm text-slate-400"/>
            :<input value={form.local_path} onChange={e=>set('local_path',e.target.value)} placeholder="C:\Music\emergency.mp3"
                className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
          }
        </div>
        {error && <div className="bg-rose-50 text-rose-600 p-4 rounded-2xl text-sm font-bold">{error}</div>}
      </div>
      <div className="flex gap-3 mt-7">
        <button onClick={async()=>{if(!form.label){setError('חובה שם');return;}setSaving(true);try{await onSave(form);}catch(e){setError(e.message);setSaving(false);}}}
          disabled={saving} className="flex-1 bg-rose-600 text-white py-4 rounded-[20px] font-black hover:bg-rose-700 transition disabled:opacity-50">
          {saving?'שומר...':'הוסף'}
        </button>
        <button onClick={onClose} className="px-8 py-4 rounded-[20px] font-black text-slate-400 bg-slate-50">ביטול</button>
      </div>
    </Modal>
  );
}

// ===== Modal: Import Schedule from PDF/Excel =====
function ImportScheduleModal({ onClose, onImport }) {
  const [file,     setFile]     = useState(null);
  const [entries,  setEntries]  = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading,  setLoading]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');
  const [days,     setDays]     = useState('0,1,2,3,4,5');

  const [rawText, setRawText] = useState('');

  const parseFile = async () => {
    if (!file) return;
    setLoading(true); setError(''); setEntries([]); setSelected(new Set()); setRawText('');
    try {
      const fd = new FormData(); fd.append('file', file);
      const res  = await fetch('/api/bells/import-schedule', { method:'POST', body: fd });
      const data = await res.json().catch(() => { throw new Error(`שגיאת שרת (${res.status})`); });
      if (!res.ok) {
        if (data.rawText) setRawText(data.rawText);
        throw new Error(data.error);
      }
      setEntries(data.entries||[]);
      setSelected(new Set(data.entries.map((_,i)=>i)));
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const updateEntry = (i, key, val) =>
    setEntries(prev => prev.map((e,idx) => idx===i ? {...e,[key]:val} : e));

  const toggleSel = i => setSelected(s => { const n=new Set(s); n.has(i)?n.delete(i):n.add(i); return n; });

  const doImport = async () => {
    const bells = entries
      .filter((_,i) => selected.has(i))
      .map(e => ({ ...e, days, audio_type:'local_path', local_path: e.local_path||'' }));
    if (!bells.length) return;
    setSaving(true);
    try { await onImport(bells); }
    catch(e) { setError(e.message); setSaving(false); }
  };

  return (
    <Modal onClose={onClose} wide>
      <h2 className="text-2xl font-black mb-1">📥 ייבוא מערכת שעות</h2>
      <p className="text-slate-400 text-sm mb-5">Excel / PDF → צלצולים בלחיצה אחת</p>

      <div className="space-y-3 mb-5">
        <input type="file" accept=".xlsx,.xls,.csv,.pdf"
          onChange={e=>{ setFile(e.target.files[0]); setEntries([]); setSelected(new Set()); setError(''); }}
          className="w-full p-4 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 text-sm text-slate-500"/>
        <button onClick={parseFile} disabled={!file||loading}
          className="w-full bg-blue-600 text-white py-3.5 rounded-2xl font-black hover:bg-blue-700 transition disabled:opacity-50">
          {loading ? 'מנתח...' : '🔍 נתח קובץ'}
        </button>
      </div>

      {error && (
        <div className="bg-rose-50 text-rose-600 p-4 rounded-2xl text-sm font-bold mb-4">
          {error}
          {rawText && (
            <details className="mt-3">
              <summary className="cursor-pointer text-rose-400 font-normal text-xs">טקסט שחולץ מהקובץ (לאבחון)</summary>
              <pre className="mt-2 text-xs font-mono whitespace-pre-wrap text-slate-500 bg-white rounded-xl p-3 max-h-40 overflow-y-auto border border-slate-200 text-right">{rawText}</pre>
            </details>
          )}
        </div>
      )}

      {entries.length > 0 && (
        <>
          <div className="mb-4">
            <label className="block text-sm font-bold text-slate-400 mb-2">ימים לייבא</label>
            <DaySelector value={days} onChange={setDays}/>
            <div className="mt-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 text-xs text-amber-700">
              💡 לוח שעות שונה ביום שישי? ייבא פעמיים: פעם עם ימים א׳–ה׳, ופעם נוספת עם יום ו׳ בלבד.
            </div>
          </div>

          <div className="flex justify-between items-center mb-2">
            <span className="text-slate-400 text-sm font-bold">נמצאו {entries.length} · {selected.size} נבחרו</span>
            <div className="flex gap-3">
              <button onClick={()=>setSelected(new Set(entries.map((_,i)=>i)))} className="text-blue-600 font-bold text-sm">הכל</button>
              <button onClick={()=>setSelected(new Set())} className="text-slate-400 font-bold text-sm">נקה</button>
            </div>
          </div>

          <div className="space-y-2 max-h-72 overflow-y-auto mb-5 border border-slate-100 rounded-2xl p-3">
            {entries.map((e, i) => {
              const ti = getBellTypeInfo(e.bell_type);
              return (
              <div key={i} className={`flex items-start gap-3 p-3 rounded-xl hover:bg-slate-50 ${selected.has(i)?'':'opacity-40'}`}>
                <input type="checkbox" checked={selected.has(i)} onChange={()=>toggleSel(i)} className="w-5 h-5 accent-blue-600 mt-1 flex-shrink-0"/>
                <span className="text-lg mt-0.5">{ti.icon}</span>
                <div className="flex-1 grid grid-cols-2 gap-2">
                  <input value={e.time} onChange={ev=>updateEntry(i,'time',ev.target.value)}
                    className="p-2 bg-slate-50 rounded-xl border border-slate-200 font-mono font-bold text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"/>
                  <input value={e.label} onChange={ev=>updateEntry(i,'label',ev.target.value)}
                    className="p-2 bg-slate-50 rounded-xl border border-slate-200 font-bold text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"/>
                  <select value={e.bell_type} onChange={ev=>updateEntry(i,'bell_type',ev.target.value)}
                    className="p-2 bg-slate-50 rounded-xl border border-slate-200 font-bold text-xs focus:outline-none col-span-2">
                    {BELL_TYPES.map(t=><option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
                  </select>
                  {e.bell_type==='break_start' && (
                    <div className="col-span-2 flex items-center gap-2">
                      <span className="text-xs text-amber-600 font-bold">משך הפסקה:</span>
                      <input type="number" min="0" max="60" value={e.break_duration||0}
                        onChange={ev=>updateEntry(i,'break_duration',parseInt(ev.target.value)||0)}
                        className="w-16 p-1.5 bg-amber-50 rounded-lg border border-amber-200 font-bold text-sm text-center focus:outline-none"/>
                      <span className="text-xs text-amber-500">דק׳</span>
                    </div>
                  )}
                </div>
              </div>
              );
            })}
          </div>

          <button onClick={doImport} disabled={!selected.size||saving}
            className="w-full bg-emerald-600 text-white py-4 rounded-[20px] font-black hover:bg-emerald-700 transition disabled:opacity-50">
            {saving ? 'מייבא...' : `✅ ייבא ${selected.size} צלצולים`}
          </button>
        </>
      )}

      <button onClick={onClose} className="w-full mt-3 py-4 rounded-[20px] font-black text-slate-400 bg-slate-50">ביטול</button>
    </Modal>
  );
}

// ===== Modal: PDF Vacation Import =====
function PDFVacationImportModal({ onClose, onImport }) {
  const [phase, setPhase]   = useState('idle'); // idle | parsing | results | importing
  const [error, setError]   = useState('');
  const [pages, setPages]   = useState(0);
  const [groups, setGroups] = useState([]);
  const fileRef             = useRef(null);

  const updateLabel = (i, label) => setGroups(gs => gs.map((g, idx) => idx===i ? {...g, label} : g));
  const removeGroup = (i) => setGroups(gs => gs.filter((_, idx) => idx!==i));

  const handleFile = async (file) => {
    if (!file) return;
    setError(''); setPhase('parsing'); setGroups([]);
    try {
      const fd = new FormData(); fd.append('file', file);
      const r  = await fetch('/api/import-vacations-pdf', { method:'POST', body:fd });
      const d  = await r.json();
      if (!r.ok) throw new Error(d.error || 'שגיאה');
      if (!d.groups?.length) { setError('לא נמצאו תאריכים בקובץ — ראה הנחיות למטה'); setPhase('idle'); return; }
      setGroups(d.groups); setPages(d.pages||1); setPhase('results');
    } catch(e) { setError(e.message); setPhase('idle'); }
  };

  const doImport = async () => {
    const days = groups.flatMap(g => g.days.map(d => ({ date:d, label:g.label })));
    if (!days.length) return;
    setPhase('importing');
    try { await onImport(days); } catch(e) { setError(e.message); setPhase('results'); }
  };

  const totalDays = groups.reduce((s, g) => s + g.days.length, 0);

  return (
    <Modal onClose={onClose} wide>
      <h2 className="text-2xl font-black mb-1">📄 ייבוא חופשות מ-PDF</h2>
      <p className="text-slate-400 text-sm mb-5">קריאה אוטומטית של תאריכים עבריים ולועזיים מקובץ PDF</p>

      {/* Instructions */}
      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5 mb-5 text-sm text-right space-y-2">
        <div className="font-black text-blue-700 mb-2">📋 איך הקובץ צריך להיראות?</div>
        <div className="text-blue-700 font-bold text-xs mb-1">הפורמטים הנתמכים:</div>
        <div className="grid grid-cols-1 gap-1 text-xs font-mono">
          <div className="bg-white rounded-xl px-3 py-1.5 text-slate-700">כ"ה כסלו – ג' טבת  <span className="text-blue-400">← עברי: טווח</span></div>
          <div className="bg-white rounded-xl px-3 py-1.5 text-slate-700">כ"ה כסלו תשפ"ו  <span className="text-blue-400">← עברי עם שנה</span></div>
          <div className="bg-white rounded-xl px-3 py-1.5 text-slate-700">01/09/2026  <span className="text-blue-400">← לועזי מלא</span></div>
          <div className="bg-white rounded-xl px-3 py-1.5 text-slate-700">1.9.2026  <span className="text-blue-400">← לועזי מלא</span></div>
          <div className="bg-white rounded-xl px-3 py-1.5 text-slate-700">1.9 – 15.9  <span className="text-blue-400">← לועזי קצר: טווח</span></div>
          <div className="bg-white rounded-xl px-3 py-1.5 text-slate-700">1 בספטמבר  <span className="text-blue-400">← לועזי עם שם חודש</span></div>
          <div className="bg-white rounded-xl px-3 py-1.5 text-slate-700">חנוכה 25.11–2.12  <span className="text-blue-400">← תווית + תאריכים</span></div>
        </div>
        <div className="text-blue-600 text-xs mt-2">
          <span className="font-black">טיפ:</span> כל שורה שמכילה תאריך מזוהה אוטומטית. תיאור על שורה לפני התאריך יהפוך לשם החופשה.
        </div>
      </div>

      {/* Upload */}
      {(phase==='idle' || phase==='parsing') && (
        <div className="space-y-4">
          <div
            className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition ${phase==='parsing'?'border-blue-300 bg-blue-50':'border-slate-200 hover:border-blue-300 hover:bg-blue-50/30'}`}
            onClick={()=>phase!=='parsing'&&fileRef.current?.click()}>
            <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={e=>handleFile(e.target.files[0])}/>
            {phase==='parsing' ? (
              <div className="text-blue-600 font-black">
                <div className="text-3xl mb-2 animate-spin inline-block">⏳</div>
                <div>מנתח קובץ...</div>
              </div>
            ) : (
              <>
                <div className="text-4xl mb-2">📄</div>
                <div className="font-black text-slate-600">לחץ לבחירת קובץ PDF</div>
                <div className="text-slate-400 text-xs mt-1">קובץ לוח שנה, מכתב מנהל, מערכת שנתית וכד׳</div>
              </>
            )}
          </div>
          {error && <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-rose-600 font-bold text-sm">{error}</div>}
        </div>
      )}

      {/* Results */}
      {phase==='results' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-slate-400 text-xs">{pages} עמוד/ים</div>
            <div className="font-black text-emerald-600">{totalDays} ימי חופשה זוהו</div>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {groups.map((g, i) => (
              <div key={i} className="flex items-center gap-3 bg-slate-50 rounded-2xl p-3">
                <div className="text-center min-w-[80px]">
                  <div className="text-xs font-black text-slate-700 tabular-nums">
                    {g.dateFrom===g.dateTo ? g.dateFrom : `${g.dateFrom} – ${g.dateTo}`}
                  </div>
                  <div className="text-[10px] text-slate-400">{g.days.length} ימים</div>
                </div>
                <input
                  value={g.label}
                  onChange={e=>updateLabel(i,e.target.value)}
                  className="flex-1 p-2 bg-white rounded-xl border border-slate-200 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0"
                  placeholder="שם החופשה"/>
                <button onClick={()=>removeGroup(i)} className="text-slate-300 hover:text-rose-500 text-lg flex-shrink-0">✕</button>
              </div>
            ))}
          </div>
          {error && <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-rose-600 font-bold text-sm">{error}</div>}
          <div className="flex gap-3 pt-2">
            <button onClick={doImport} disabled={groups.length===0||phase==='importing'}
              className="flex-1 bg-emerald-600 text-white py-4 rounded-[20px] font-black hover:bg-emerald-700 transition disabled:opacity-50">
              {phase==='importing' ? 'מייבא...' : `✅ ייבא ${totalDays} ימים`}
            </button>
            <button onClick={()=>{setPhase('idle');setGroups([]);setError('');}}
              className="px-6 py-4 rounded-[20px] font-black text-slate-400 bg-slate-50 hover:bg-slate-100">
              חדש
            </button>
          </div>
        </div>
      )}

      <button onClick={onClose} className="w-full mt-4 py-3 rounded-[20px] font-black text-slate-400 bg-slate-50">סגור</button>
    </Modal>
  );
}

// ===== Monthly Calendar =====
function RestartServerCard() {
  const [state, setState] = useState('idle'); // idle | confirm | restarting
  const [count, setCount] = useState(10);

  const doRestart = async () => {
    setState('restarting');
    setCount(10);
    try { await api('/api/restart', { method: 'POST' }); } catch {}
    let c = 10;
    const iv = setInterval(() => {
      c--;
      setCount(c);
      if (c <= 0) {
        clearInterval(iv);
        window.location.reload();
      }
    }, 1000);
  };

  if (state === 'restarting') return (
    <div className="text-center py-4">
      <div className="text-3xl mb-2 animate-spin">🔄</div>
      <div className="font-black text-slate-700 mb-1">מאתחל שרת...</div>
      <div className="text-slate-400 text-sm">הדף יתרענן בעוד {count} שניות</div>
    </div>
  );

  if (state === 'confirm') return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500 text-right">פעולה זו תפעיל מחדש את שרת הצלצולים. הצלצולים יופסקו לכמה שניות.</p>
      <div className="flex gap-2">
        <button onClick={()=>setState('idle')} className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-2xl font-bold text-sm">ביטול</button>
        <button onClick={doRestart} className="flex-1 py-2.5 bg-rose-600 text-white rounded-2xl font-bold text-sm hover:bg-rose-700">הפעל מחדש</button>
      </div>
    </div>
  );

  return (
    <div className="flex items-center justify-between">
      <button onClick={()=>setState('confirm')} className="px-5 py-2.5 bg-rose-50 text-rose-600 rounded-2xl font-bold text-sm hover:bg-rose-100 transition">🔄 הפעל שרת מחדש</button>
      <span className="text-xs text-slate-400">לשימוש כשמשהו משתבש</span>
    </div>
  );
}

const CAL_TYPES = {
  shabbat:     { cell: 'bg-violet-50 border-violet-100',  numCls: 'text-violet-300', label: 'שבת',           dot: 'bg-violet-300'  },
  holiday:     { cell: 'bg-rose-50 border-rose-100',      numCls: 'text-rose-400',   label: 'חג ישראלי',     dot: 'bg-rose-400'    },
  vacation:    { cell: 'bg-amber-50 border-amber-200',    numCls: 'text-amber-600',  label: 'חופשה',          dot: 'bg-amber-400'   },
  special:     { cell: 'bg-purple-50 border-purple-200',  numCls: 'text-purple-600', label: 'מערכת מיוחדת',  dot: 'bg-purple-400'  },
  regular:     { cell: 'bg-blue-50 border-blue-100',      numCls: 'text-blue-700',   label: 'מערכת רגילה',   dot: 'bg-blue-400'    },
  no_schedule: { cell: 'bg-slate-50 border-slate-100',    numCls: 'text-slate-300',  label: 'ללא מערכת',     dot: 'bg-slate-200'   },
};
const DAY_NAMES_FULL = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];

function MonthlyCalendar({ data, dayOverrides, upcomingHolidays, onRefresh }) {
  const [viewDate,    setViewDate]    = useState(() => { const n=new Date(); return new Date(n.getFullYear(),n.getMonth(),1); });
  const [calType,     setCalType]     = useState('gregorian');
  const [selectedDay, setSelectedDay] = useState(null);
  const [showYear,    setShowYear]    = useState(false);
  const [managingVac, setManagingVac] = useState(false);
  const [vacLabel,    setVacLabel]    = useState('');
  const [managingOv,  setManagingOv]  = useState(false);
  const [ovFromDay,   setOvFromDay]   = useState('0');

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const todayStr = new Date().toISOString().split('T')[0];

  const calDays = useMemo(() => {
    const days = [], first = new Date(year,month,1).getDay(), total = new Date(year,month+1,0).getDate();
    for (let i=0;i<first;i++) days.push(null);
    for (let d=1;d<=total;d++) days.push(new Date(year,month,d));
    return days;
  }, [year,month]);

  const holidayMap  = useMemo(()=> new Map((upcomingHolidays||[]).map(h=>[h.date,h])),     [upcomingHolidays]);
  const vacMap      = useMemo(()=> new Map((data.vacations||[]).map(v=>[v.date,v])),        [data.vacations]);
  const overrideMap = useMemo(()=> new Map((dayOverrides||[]).map(o=>[o.date,o])),          [dayOverrides]);

  const getDayType = (date) => {
    if (!date) return null;
    const ds  = date.toISOString().split('T')[0];
    const dow = date.getDay();
    if (dow === 6)             return 'shabbat';
    if (holidayMap.has(ds))    return 'holiday';
    if (vacMap.has(ds))        return 'vacation';
    const ov = overrideMap.get(ds);
    const effectiveDow = ov ? ov.from_day : dow;
    const hasBells = (data.bells||[]).some(b => b.is_active && (b.days||'0,1,2,3,4,5').split(',').includes(String(effectiveDow)));
    if (ov)        return 'special';
    if (hasBells)  return 'regular';
    return 'no_schedule';
  };

  const getBells = (date) => {
    if (!date) return [];
    const ds  = date.toISOString().split('T')[0];
    const ov  = overrideMap.get(ds);
    const dow = ov ? ov.from_day : date.getDay();
    return (data.bells||[]).filter(b => b.is_active && (b.days||'0,1,2,3,4,5').split(',').includes(String(dow))).sort((a,b)=>a.time.localeCompare(b.time));
  };

  const hebDay   = d => { try { return new Intl.DateTimeFormat('he-u-ca-hebrew',{day:'numeric'}).format(d); }           catch { return ''; } };
  const hebMonth = d => { try { return new Intl.DateTimeFormat('he-u-ca-hebrew',{month:'long',year:'numeric'}).format(d); } catch { return ''; } };

  const selectDay = (ds) => { setSelectedDay(s=>s===ds?null:ds); setManagingVac(false); setManagingOv(false); };

  const addVacation = async () => {
    try { await api('/api/vacations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:selectedDay,label:vacLabel||'חופשה'})}); setManagingVac(false); setVacLabel(''); onRefresh(); notify('חופשה נוספה'); } catch(e){notify(e.message,'error');}
  };
  const removeVacation = async () => {
    try { await api(`/api/vacations/${selectedDay}`,{method:'DELETE'}); onRefresh(); notify('חופשה הוסרה'); } catch(e){notify(e.message,'error');}
  };
  const addOverride = async () => {
    try { await api('/api/day-overrides',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:selectedDay,from_day:parseInt(ovFromDay),label:''})}); setManagingOv(false); onRefresh(); notify('מערכת עקיפה נוספה'); } catch(e){notify(e.message,'error');}
  };
  const removeOverride = async () => {
    try { await api(`/api/day-overrides/${selectedDay}`,{method:'DELETE'}); onRefresh(); notify('עקיפה הוסרה'); } catch(e){notify(e.message,'error');}
  };

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={()=>setViewDate(new Date(year,month-1,1))} className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 font-black hover:bg-slate-200 flex items-center justify-center text-lg">›</button>
          <div className="text-center min-w-[200px]">
            <div className="font-black text-slate-800 text-base">
              {calType==='hebrew' ? hebMonth(viewDate) : viewDate.toLocaleDateString('he-IL',{month:'long',year:'numeric'})}
            </div>
            {calType==='gregorian' && <div className="text-xs text-slate-400 font-semibold">{hebMonth(viewDate)}</div>}
          </div>
          <button onClick={()=>setViewDate(new Date(year,month+1,1))} className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 font-black hover:bg-slate-200 flex items-center justify-center text-lg">‹</button>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={()=>setViewDate(new Date(new Date().getFullYear(),new Date().getMonth(),1))} className="px-3 py-2 rounded-xl bg-blue-50 text-blue-600 font-bold text-sm hover:bg-blue-100">היום</button>
          <button onClick={()=>setCalType(t=>t==='hebrew'?'gregorian':'hebrew')}
            className={`px-3 py-2 rounded-xl font-bold text-sm transition ${calType==='hebrew'?'bg-blue-600 text-white':'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {calType==='hebrew'?'🇮🇱 עברי':'📅 לועזי'}
          </button>
          <button onClick={()=>setShowYear(v=>!v)}
            className={`px-3 py-2 rounded-xl font-bold text-sm transition ${showYear?'bg-purple-600 text-white':'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            📆 שנה שלמה
          </button>
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(CAL_TYPES).map(([type,st])=>(
          <div key={type} className="flex items-center gap-1.5 bg-white rounded-xl px-3 py-1.5 border border-slate-100 text-xs font-bold text-slate-500">
            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${st.dot}`}/>{st.label}
          </div>
        ))}
      </div>

      {showYear ? (
        <YearView year={year} data={data} dayOverrides={dayOverrides} upcomingHolidays={upcomingHolidays} onMonthClick={m=>{setViewDate(new Date(year,m,1));setShowYear(false);}} />
      ) : (
        <>
          {/* ── Day-name header ── */}
          <div className="grid grid-cols-7 gap-1">
            {['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'].map(d=><div key={d} className="text-center text-xs font-bold text-slate-400 py-1">{d}</div>)}
          </div>

          {/* ── Calendar grid ── */}
          <div className="grid grid-cols-7 gap-1">
            {calDays.map((day,i)=>{
              if (!day) return <div key={i}/>;
              const ds       = day.toISOString().split('T')[0];
              const type     = getDayType(day);
              const st       = CAL_TYPES[type];
              const isToday  = ds===todayStr;
              const isSel    = selectedDay===ds;
              const vac      = vacMap.get(ds);
              const hol      = holidayMap.get(ds);
              const ov       = overrideMap.get(ds);
              const bells    = getBells(day);
              const dateNum  = calType==='hebrew' ? hebDay(day) : day.getDate();
              const dateSub  = calType==='hebrew' ? day.getDate() : hebDay(day);

              return (
                <button key={ds} onClick={()=>selectDay(ds)}
                  className={`rounded-2xl p-1.5 text-right transition-all min-h-[72px] flex flex-col border
                    ${st.cell} ${isSel?'ring-2 ring-blue-500':''}
                    ${isToday&&!isSel?'ring-2 ring-blue-400':''}
                    hover:opacity-80`}>
                  <div className="flex justify-between items-start w-full mb-0.5">
                    <span className="text-[8px] font-bold text-slate-300 leading-none">{dateSub}</span>
                    <span className={`text-sm font-black leading-none ${isToday?'bg-blue-600 text-white w-5 h-5 rounded-full flex items-center justify-center text-[11px]':st.numCls}`}>
                      {dateNum}
                    </span>
                  </div>
                  {vac && <div className="text-[8px] font-bold text-amber-600 leading-tight truncate">{vac.label}</div>}
                  {hol && !vac && <div className="text-[8px] font-bold text-rose-500 leading-tight truncate">{hol.he||hol.desc}</div>}
                  {ov  && !vac && <div className="text-[8px] font-bold text-purple-500 leading-tight truncate">כ{DAY_NAMES_FULL[ov.from_day]}</div>}
                  {type==='regular' && bells.length>0 && (
                    <div className="flex flex-wrap gap-0.5 mt-auto">
                      {bells.slice(0,2).map((b,bi)=><div key={bi} className="text-[8px] bg-blue-200 text-blue-700 rounded px-0.5 font-bold leading-tight">{b.time}</div>)}
                      {bells.length>2 && <div className="text-[8px] text-slate-400 font-bold">+{bells.length-2}</div>}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* ── Day detail + management panel ── */}
          {selectedDay && (()=>{
            const day   = new Date(selectedDay+'T12:00:00');
            const type  = getDayType(day);
            const st    = CAL_TYPES[type];
            const vac   = vacMap.get(selectedDay);
            const hol   = holidayMap.get(selectedDay);
            const ov    = overrideMap.get(selectedDay);
            const bells = getBells(day);
            const isSat = day.getDay()===6;
            return (
              <div className="bg-white rounded-[24px] border border-slate-100 p-5 shadow-sm">
                {/* Title row */}
                <div className="flex justify-between items-start mb-4">
                  <button onClick={()=>setSelectedDay(null)} className="text-slate-300 hover:text-slate-500 font-black text-lg">✕</button>
                  <div className="text-right">
                    <div className="font-black text-slate-800 text-base">{day.toLocaleDateString('he-IL',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{new Intl.DateTimeFormat('he-u-ca-hebrew',{day:'numeric',month:'long',year:'numeric'}).format(day)}</div>
                    <div className={`inline-flex items-center gap-1.5 mt-1 px-3 py-0.5 rounded-full text-xs font-bold ${st.cell} ${st.numCls}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`}/>{st.label}
                    </div>
                  </div>
                </div>

                {/* Holiday badge */}
                {hol && (
                  <div className="bg-rose-50 border border-rose-100 rounded-2xl px-4 py-2 mb-3 text-center">
                    <span className="text-xs font-black text-rose-600">🕍 {hol.he||hol.desc}</span>
                  </div>
                )}

                {/* Content */}
                {isSat ? (
                  <div className="text-center text-violet-300 py-4 font-bold text-sm">שבת — אין צלצולים</div>
                ) : vac ? (
                  <div className="bg-amber-50 rounded-2xl p-4 text-center mb-3">
                    <div className="text-2xl mb-1">🏖️</div>
                    <div className="font-black text-amber-700">{vac.label}</div>
                  </div>
                ) : bells.length===0 ? (
                  <div className="text-center text-slate-300 py-4 font-bold text-sm">אין צלצולים ביום זה</div>
                ) : (
                  <div className="space-y-1.5 mb-3">
                    {ov && <div className="text-xs text-purple-500 font-bold text-right mb-2">⚡ מופעל כ{DAY_NAMES_FULL[ov.from_day]}</div>}
                    {bells.map((b,bi)=>(
                      <div key={bi} className="flex items-center justify-between bg-slate-50 rounded-2xl px-4 py-2">
                        <div className="text-sm text-slate-500 truncate">{b.label}</div>
                        <div className="font-black text-blue-600 tabular-nums text-sm">{b.time}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Management buttons */}
                {!isSat && (
                  <div className="border-t border-slate-100 pt-3 space-y-2">
                    {vac ? (
                      <button onClick={removeVacation} className="w-full bg-amber-50 text-amber-700 py-2.5 rounded-2xl font-bold text-sm hover:bg-amber-100 transition">🗑 הסר חופשה</button>
                    ) : managingVac ? (
                      <div className="flex gap-2">
                        <button onClick={()=>setManagingVac(false)} className="px-3 py-2.5 bg-slate-100 text-slate-500 rounded-2xl font-bold text-sm">ביטול</button>
                        <input value={vacLabel} onChange={e=>setVacLabel(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addVacation()} placeholder="שם החופשה" autoFocus className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2 text-sm text-right font-bold outline-none focus:border-amber-400"/>
                        <button onClick={addVacation} className="px-4 py-2.5 bg-amber-500 text-white rounded-2xl font-bold text-sm hover:bg-amber-600">הוסף</button>
                      </div>
                    ) : (
                      <button onClick={()=>{setManagingVac(true);setManagingOv(false);}} className="w-full bg-slate-50 text-slate-500 py-2.5 rounded-2xl font-bold text-sm hover:bg-amber-50 hover:text-amber-600 transition">+ סמן כחופשה</button>
                    )}

                    {!vac && (ov ? (
                      <button onClick={removeOverride} className="w-full bg-purple-50 text-purple-600 py-2.5 rounded-2xl font-bold text-sm hover:bg-purple-100 transition">🗑 הסר עקיפת מערכת</button>
                    ) : managingOv ? (
                      <div className="flex gap-2">
                        <button onClick={()=>setManagingOv(false)} className="px-3 py-2.5 bg-slate-100 text-slate-500 rounded-2xl font-bold text-sm">ביטול</button>
                        <select value={ovFromDay} onChange={e=>setOvFromDay(e.target.value)} className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2 text-sm font-bold text-right">
                          {DAY_NAMES_FULL.slice(0,6).map((n,i)=><option key={i} value={i}>הפעל מערכת כ{n}</option>)}
                        </select>
                        <button onClick={addOverride} className="px-4 py-2.5 bg-purple-500 text-white rounded-2xl font-bold text-sm hover:bg-purple-600">קבע</button>
                      </div>
                    ) : (
                      <button onClick={()=>{setManagingOv(true);setManagingVac(false);}} className="w-full bg-slate-50 text-slate-500 py-2.5 rounded-2xl font-bold text-sm hover:bg-purple-50 hover:text-purple-600 transition">⚡ שנה מערכת ליום זה</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

function YearView({ year, data, dayOverrides, upcomingHolidays, onMonthClick }) {
  const holidaySet  = useMemo(()=> new Set((upcomingHolidays||[]).map(h=>h.date)), [upcomingHolidays]);
  const vacSet      = useMemo(()=> new Set((data.vacations||[]).map(v=>v.date)),   [data.vacations]);
  const overrideMap = useMemo(()=> new Map((dayOverrides||[]).map(o=>[o.date,o])), [dayOverrides]);
  const now = new Date();

  const getMonthStats = (m) => {
    const total = new Date(year,m+1,0).getDate();
    let school=0, vac=0, hol=0;
    for (let d=1;d<=total;d++) {
      const date = new Date(year,m,d);
      const ds   = date.toISOString().split('T')[0];
      const dow  = date.getDay();
      if (dow===6) continue;
      if (vacSet.has(ds))     { vac++;    continue; }
      if (holidaySet.has(ds)) { hol++;    continue; }
      const ov = overrideMap.get(ds);
      const effectiveDow = ov ? ov.from_day : dow;
      const hasBells = (data.bells||[]).some(b=>b.is_active&&(b.days||'0,1,2,3,4,5').split(',').includes(String(effectiveDow)));
      if (hasBells) school++;
    }
    return { school, vac, hol };
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {Array.from({length:12},(_,m)=>{
        const md  = new Date(year,m,1);
        const {school,vac,hol} = getMonthStats(m);
        const isCurrent = now.getFullYear()===year && now.getMonth()===m;
        return (
          <button key={m} onClick={()=>onMonthClick(m)}
            className={`rounded-[20px] border p-4 text-right hover:shadow-md transition-all ${isCurrent?'border-blue-300 bg-blue-50':'border-slate-100 bg-white hover:border-blue-200'}`}>
            <div className={`font-black text-base mb-1 ${isCurrent?'text-blue-700':'text-slate-700'}`}>{md.toLocaleDateString('he-IL',{month:'long'})}</div>
            <div className="text-xs text-slate-400 mb-2">{year}</div>
            <div className="flex flex-wrap gap-1 text-[10px]">
              {school>0 && <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-lg font-bold">{school} לימוד</span>}
              {hol>0    && <span className="bg-rose-50 text-rose-500 px-2 py-0.5 rounded-lg font-bold">{hol} חגים</span>}
              {vac>0    && <span className="bg-amber-50 text-amber-600 px-2 py-0.5 rounded-lg font-bold">{vac} חופשה</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ===== Modal: Remote Access (QR code for management) =====
function RemoteAccessModal({ tunnelInfo, onClose }) {
  const [qrSrc, setQrSrc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/announce/qr?type=management')
      .then(r => { if (!r.ok) throw new Error('שגיאה'); return r.blob(); })
      .then(blob => { setQrSrc(URL.createObjectURL(blob)); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  const url = tunnelInfo.url || `http://${window.location.hostname}:3000`;
  const isConnected = tunnelInfo.status === 'connected';

  return (
    <Modal onClose={onClose}>
      <h2 className="text-2xl font-black mb-1">🌐 גישה מרחוק</h2>
      <p className="text-slate-400 text-sm mb-6">סרוק כדי לנהל את המערכת מכל מכשיר</p>

      <div className={`rounded-2xl p-3 mb-5 flex items-center gap-2 text-sm font-bold ${isConnected ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'}`}/>
        {isConnected ? '✅ מנהרה פעילה' : tunnelInfo.status === 'connecting' || tunnelInfo.status === 'reconnecting' ? '⏳ מתחבר...' : '⚠️ ללא חיבור מרחוק — רשת מקומית בלבד'}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400 font-bold">טוען QR...</div>
      ) : error ? (
        <div className="bg-rose-50 text-rose-600 rounded-2xl p-5 text-center font-bold">{error}</div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <img src={qrSrc} alt="QR" className="w-64 h-64 rounded-2xl border-4 border-blue-100"/>
          <div className="bg-slate-50 rounded-2xl px-4 py-3 w-full text-center">
            <div className="text-xs text-slate-400 font-bold mb-1">כתובת ניהול</div>
            <div className="font-mono text-xs text-blue-700 break-all select-all">{url}</div>
          </div>
          <p className="text-xs text-slate-400 text-center">סרוק עם הטלפון לפתיחת ממשק הניהול המלא</p>
        </div>
      )}

      <button onClick={onClose} className="w-full mt-5 py-3 rounded-[20px] font-black text-slate-400 bg-slate-50">סגור</button>
    </Modal>
  );
}

// ===== Modal: Announce (desktop – immediate + leave message) =====
function AnnounceModal({ announceActive, onClose, onLeaveMessage }) {
  const [inputDevices,  setInputDevices]  = useState([]);
  const [selectedInput, setSelectedInput] = useState('');
  const [liveStatus,    setLiveStatus]    = useState({ active: false });

  const loadInputDevices = () => fetch('/api/input-devices').then(r=>r.json()).then(d=>{
    setInputDevices(d.devices||[]);
    if (d.devices?.length && !selectedInput) setSelectedInput(d.devices[0]);
  }).catch(()=>{});
  const loadLiveStatus = () => fetch('/api/live-announce/status').then(r=>r.json()).then(setLiveStatus).catch(()=>{});

  useEffect(()=>{
    loadInputDevices(); loadLiveStatus();
    const iv = setInterval(loadLiveStatus, 1500);
    return () => clearInterval(iv);
  }, []);

  const startLive = async () => {
    if (!selectedInput) return;
    try {
      const r = await fetch('/api/live-announce/start', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ device: selectedInput }) });
      if (!r.ok) { const e = await r.json(); notify(e.error, 'error'); return; }
      notify('🎙️ כריזה חיה פעילה');
      loadLiveStatus();
    } catch { notify('שגיאה', 'error'); }
  };

  const stopLive = async () => {
    await fetch('/api/live-announce/stop', { method:'POST' });
    notify('כריזה הופסקה'); loadLiveStatus();
  };

  return (
    <Modal onClose={onClose}>
      <h2 className="text-2xl font-black mb-1">📢 כריזה מיידית</h2>
      <p className="text-slate-400 text-sm mb-6">שידור חי דרך המיקרופון</p>

      {(announceActive || liveStatus.active) && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 mb-5 flex items-center gap-3 animate-pulse">
          <span className="text-xl">📢</span>
          <div>
            <div className="font-black text-rose-700">כריזה פעילה {liveStatus.active ? '🎙️' : ''}</div>
            <div className="text-rose-500 text-xs">{liveStatus.active ? `מ: ${liveStatus.device}` : 'מתנגן ברמקולים'}</div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-bold text-slate-400 mb-2">התקן קלט (מיקרופון)</label>
          {inputDevices.length === 0 ? (
            <div className="bg-amber-50 rounded-2xl p-4 text-amber-700 text-sm font-bold text-center">
              לא נמצאו התקני קלט
              <div className="text-xs font-normal mt-1">ודא שמיקרופון מחובר ו-FFmpeg מותקן</div>
              <button onClick={loadInputDevices} className="mt-2 bg-amber-100 text-amber-700 px-4 py-1.5 rounded-xl text-xs font-bold">🔄 רענן</button>
            </div>
          ) : (
            <select value={selectedInput} onChange={e=>setSelectedInput(e.target.value)}
              className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
              {inputDevices.map(d=><option key={d} value={d}>{d}</option>)}
            </select>
          )}
        </div>

        {liveStatus.active ? (
          <div className="space-y-3">
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5 text-center animate-pulse">
              <div className="text-4xl mb-2">🎙️</div>
              <div className="font-black text-rose-700 text-xl">כריזה פעילה</div>
              <div className="text-rose-500 text-xs mt-1">{liveStatus.device}</div>
            </div>
            <button onClick={stopLive}
              className="w-full bg-rose-600 text-white py-4 rounded-[20px] font-black text-lg hover:bg-rose-700 transition">
              ⏹ עצור כריזה
            </button>
          </div>
        ) : (
          <button onClick={startLive} disabled={!selectedInput || inputDevices.length===0}
            className="w-full bg-blue-600 text-white py-5 rounded-[20px] font-black text-xl hover:bg-blue-700 transition disabled:opacity-40">
            🎙️ התחל כריזה
          </button>
        )}
      </div>

      <div className="mt-5 pt-5 border-t border-slate-100 space-y-3">
        <button onClick={onLeaveMessage}
          className="w-full bg-emerald-600 text-white py-4 rounded-[20px] font-black hover:bg-emerald-700 transition">
          💬 השאר הודעה לתזמון
        </button>
        <button onClick={onClose} className="w-full py-3 rounded-[20px] font-black text-slate-400 bg-slate-50">סגור</button>
      </div>
    </Modal>
  );
}

// ===== Modal: Scheduled / Immediate Play =====
function ScheduledPlayModal({ onClose, onSave }) {
  const [form, setForm] = useState({ label:'', audio_type:'upload', local_path:'', play_at:'', file:null });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  return (
    <Modal onClose={onClose}>
      <h2 className="text-2xl font-black mb-2">💬 השאר הודעה</h2>
      <p className="text-slate-400 text-sm mb-6">העלה קובץ שמע לנגינה מיידית או בשעה קבועה</p>
      <div className="space-y-5">
        <div>
          <label className="block text-sm font-bold text-slate-400 mb-2">תיאור (אופציונלי)</label>
          <input value={form.label} onChange={e=>set('label',e.target.value)} placeholder="לדוגמה: הודעה לכיתה ב׳"
            className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"/>
        </div>
        <div>
          <label className="block text-sm font-bold text-slate-400 mb-2">קובץ שמע</label>
          <div className="flex gap-2 mb-3">
            {[['upload','📁 העלאה'],['local_path','💾 נתיב']].map(([v,l])=>(
              <button key={v} type="button" onClick={()=>set('audio_type',v)}
                className={`flex-1 py-3 rounded-2xl font-bold text-sm transition-all ${form.audio_type===v?'bg-blue-600 text-white':'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>{l}</button>
            ))}
          </div>
          {form.audio_type==='upload'
            ? <input type="file" accept=".mp3,.wav,.ogg,.aac,.flac,.m4a,.webm"
                onChange={e=>set('file',e.target.files[0])}
                className="w-full p-4 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 text-sm text-slate-400"/>
            : <input value={form.local_path} onChange={e=>set('local_path',e.target.value)} placeholder="C:\Audio\message.mp3"
                className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
          }
        </div>
        <div>
          <label className="block text-sm font-bold text-slate-400 mb-2">מתי לנגן?</label>
          <div className="flex gap-2 mb-3">
            <button type="button" onClick={()=>set('play_at','')}
              className={`flex-1 py-3 rounded-2xl font-bold text-sm transition-all ${!form.play_at?'bg-emerald-600 text-white':'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>
              ▶ עכשיו
            </button>
            <button type="button" onClick={()=>{ if(!form.play_at) set('play_at', new Date(Date.now()+3600000).toISOString().slice(0,16).replace('T',' ')); }}
              className={`flex-1 py-3 rounded-2xl font-bold text-sm transition-all ${form.play_at?'bg-amber-500 text-white':'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>
              ⏰ בשעה...
            </button>
          </div>
          {form.play_at && (
            <input type="datetime-local" value={form.play_at.replace(' ','T')}
              onChange={e=>set('play_at', e.target.value.replace('T',' '))}
              className="w-full p-4 bg-amber-50 rounded-2xl border border-amber-200 font-bold focus:outline-none focus:ring-2 focus:ring-amber-400"/>
          )}
        </div>
        {error && <div className="bg-rose-50 text-rose-600 p-4 rounded-2xl text-sm font-bold">{error}</div>}
      </div>
      <div className="flex gap-3 mt-7">
        <button onClick={async()=>{
          if(form.audio_type==='upload'&&!form.file){setError('בחר קובץ');return;}
          if(form.audio_type==='local_path'&&!form.local_path){setError('הכנס נתיב');return;}
          setSaving(true);
          try{await onSave(form);}catch(e){setError(e.message);setSaving(false);}
        }}
          disabled={saving}
          className="flex-1 bg-emerald-600 text-white py-4 rounded-[20px] font-black hover:bg-emerald-700 transition disabled:opacity-50">
          {saving?'שומר...':(form.play_at?'⏰ תזמן':'▶ נגן עכשיו')}
        </button>
        <button onClick={onClose} className="px-8 py-4 rounded-[20px] font-black text-slate-400 bg-slate-50">ביטול</button>
      </div>
    </Modal>
  );
}

// ===== Modal: Folder Import into Playlist =====
function FolderImportModal({ onClose, onImport }) {
  const [folderPath, setFolderPath] = useState('');
  const [saving, setSaving]         = useState(false);
  const [error,  setError]          = useState('');

  return (
    <Modal onClose={onClose}>
      <h2 className="text-2xl font-black mb-2">📂 ייבוא מתיקיה</h2>
      <p className="text-slate-400 text-sm mb-6">ציין נתיב תיקיה בשרת — כל קבצי השמע שבה יתווספו לפלייליסט</p>
      <div>
        <label className="block text-sm font-bold text-slate-400 mb-2">נתיב תיקיה</label>
        <input value={folderPath} onChange={e=>setFolderPath(e.target.value)}
          placeholder="C:\Music\School"
          className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
        <p className="text-xs text-slate-400 mt-1">נתיב מלא בשרת Windows — יובאו mp3, wav, ogg, aac, flac, m4a</p>
      </div>
      {error && <div className="mt-4 bg-rose-50 text-rose-600 p-4 rounded-2xl text-sm font-bold">{error}</div>}
      <div className="flex gap-3 mt-7">
        <button onClick={async()=>{
          if(!folderPath){setError('הכנס נתיב תיקיה');return;}
          setSaving(true);
          try{await onImport(folderPath);}catch(e){setError(e.message);setSaving(false);}
        }}
          disabled={saving}
          className="flex-1 bg-violet-600 text-white py-4 rounded-[20px] font-black hover:bg-violet-700 transition disabled:opacity-50">
          {saving?'מייבא...':'ייבא'}
        </button>
        <button onClick={onClose} className="px-8 py-4 rounded-[20px] font-black text-slate-400 bg-slate-50">ביטול</button>
      </div>
    </Modal>
  );
}

// ===== Modal: Silent =====
function SilentModal({ silentMode, onClose, onApply }) {
  const [duration, setDuration] = useState(60);
  const [applying, setApplying] = useState(false);
  const PRESETS = [{label:'30 דקות',v:30},{label:'שעה',v:60},{label:'שעה וחצי',v:90},{label:'2 שעות',v:120},{label:'4 שעות',v:240}];

  return (
    <Modal onClose={onClose}>
      <h2 className="text-2xl font-black mb-1">🔇 השתקת מערכת</h2>
      <p className="text-slate-400 text-sm mb-6">הצלצולים לא יישמעו עד שזמן ההשתקה יפוג</p>

      {silentMode.active && (
        <div className="bg-slate-800 text-white rounded-2xl p-4 mb-5 flex items-center justify-between">
          <div>
            <div className="font-black">🔇 השתקה פעילה</div>
            <div className="text-slate-300 text-sm mt-0.5">נותרו {silentMode.minutesLeft} דקות</div>
          </div>
          <button onClick={async()=>{setApplying(true);await onApply(0);}}
            className="bg-white text-slate-800 px-4 py-2 rounded-xl font-black text-sm hover:bg-slate-100">
            בטל
          </button>
        </div>
      )}

      <div className="space-y-3 mb-5">
        <label className="block text-sm font-bold text-slate-500">בחר משך השתקה:</label>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map(p=>(
            <button key={p.v} onClick={()=>setDuration(p.v)}
              className={`py-3 rounded-2xl font-bold text-sm transition ${duration===p.v?'bg-slate-800 text-white':'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {p.label}
            </button>
          ))}
          <button onClick={()=>setDuration(0)}
            className={`py-3 rounded-2xl font-bold text-sm transition ${duration===0?'bg-slate-800 text-white':'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            ידני
          </button>
        </div>
        {duration===0 && (
          <input type="number" min="1" max="480" placeholder="דקות"
            onChange={e=>setDuration(parseInt(e.target.value)||0)}
            className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-bold text-center text-xl focus:outline-none focus:ring-2 focus:ring-slate-400"/>
        )}
      </div>

      <div className="flex gap-3">
        <button onClick={async()=>{setApplying(true);await onApply(duration);}}
          disabled={applying||duration<=0}
          className="flex-1 bg-slate-800 text-white py-4 rounded-[20px] font-black hover:bg-slate-700 transition disabled:opacity-50">
          {applying?'...':'🔇 השתק עכשיו'}
        </button>
        <button onClick={onClose} className="px-8 py-4 rounded-[20px] font-black text-slate-400 bg-slate-50 hover:bg-slate-100">ביטול</button>
      </div>
    </Modal>
  );
}

// ===== Log: Date Group =====
function LogDateGroup({ date, dayName, entries }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-white rounded-[28px] shadow-sm border border-slate-100 overflow-hidden">
      <button onClick={()=>setOpen(o=>!o)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition">
        <div className="flex items-center gap-3">
          <span className="font-black text-slate-700">{date}</span>
          {dayName && <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">יום {dayName}</span>}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">{entries.length} צלצולים</span>
          <span className="text-slate-300 text-sm">{open?'▲':'▼'}</span>
        </div>
      </button>
      {open && (
        <div className="divide-y divide-slate-50 border-t border-slate-100">
          {entries.map(entry => (
            <div key={entry.id} className="flex items-center gap-4 px-6 py-3">
              <span className="text-blue-600 font-black tabular-nums w-14 flex-shrink-0">{entry.time_str || (entry.played_at||'').slice(11,16)}</span>
              <span className="font-bold text-slate-700">{entry.bell_label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== Modal: File Check =====
function FileCheckModal({ results, onClose }) {
  const { results: bells = [], missing = 0, total = 0 } = results || {};
  return (
    <Modal onClose={onClose}>
      <h2 className="text-2xl font-black mb-1">🔍 בדיקת קבצי שמע</h2>
      <p className="text-slate-400 text-sm mb-6">
        {total} צלצולים נבדקו ·{' '}
        {missing > 0
          ? <span className="text-rose-500 font-bold">{missing} קבצים חסרים!</span>
          : <span className="text-emerald-600 font-bold">הכל תקין ✓</span>}
      </p>
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {bells.map(b => (
          <div key={b.id} className={`flex items-center gap-3 p-3 rounded-2xl ${b.exists?'bg-emerald-50':'bg-rose-50'}`}>
            <span className="text-lg">{b.exists ? '✅' : '❌'}</span>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm">{b.label}</div>
              <div className="text-xs text-slate-400 truncate font-mono">{b.audio_source}</div>
            </div>
            <span className="text-xs font-bold text-slate-400 flex-shrink-0">{b.time}</span>
          </div>
        ))}
      </div>
      <button onClick={onClose} className="w-full mt-5 py-4 rounded-[20px] font-black text-slate-400 bg-slate-50 hover:bg-slate-100">סגור</button>
    </Modal>
  );
}

// ===== Modal: Schedule Templates =====
function TemplateModal({ templates, onClose, onSave, onLoad, onDelete, onActivate }) {
  const [newName, setNewName] = useState('');
  const [saving,   setSaving]  = useState(false);
  const [applying, setApplying] = useState(null);
  const [deleting, setDeleting] = useState(null);

  return (
    <Modal onClose={onClose}>
      <h2 className="text-2xl font-black mb-1">📋 תבניות לוח שעות</h2>
      <p className="text-slate-400 text-sm mb-6">שמור את לוח השעות הנוכחי כתבנית, או טען תבנית קיימת</p>

      <div className="bg-slate-50 rounded-2xl p-4 mb-6">
        <label className="block text-sm font-bold text-slate-500 mb-2">שמור לוח שעות נוכחי</label>
        <div className="flex gap-2">
          <input value={newName} onChange={e=>setNewName(e.target.value)}
            placeholder="שם התבנית (למשל: לוח רגיל)"
            className="flex-1 p-3 bg-white rounded-xl border border-slate-200 font-bold text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"/>
          <button
            onClick={async()=>{if(!newName.trim())return;setSaving(true);try{await onSave(newName.trim());setNewName('');}finally{setSaving(false);}}}
            disabled={saving||!newName.trim()}
            className="px-4 py-3 bg-violet-600 text-white rounded-xl font-bold text-sm hover:bg-violet-700 disabled:opacity-50 transition">
            {saving?'...':'שמור'}
          </button>
        </div>
      </div>

      {templates.length === 0
        ? <div className="text-center py-8 text-slate-300"><div className="text-4xl mb-2">📋</div><div className="font-bold">אין תבניות שמורות</div></div>
        : <div className="space-y-2 max-h-72 overflow-y-auto">
            {templates.map(t => (
              <div key={t.id} className="flex items-center gap-3 p-4 bg-white rounded-2xl border border-slate-100 shadow-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-black">{t.name}</div>
                  <div className="text-xs text-slate-400">{(t.created_at||'').slice(0,10)}</div>
                </div>
                <button
                  onClick={async()=>{ setApplying('a'+t.id); try{await onActivate?.(t.id);}finally{setApplying(null);} }}
                  disabled={applying==='a'+t.id}
                  className="px-3 py-2 bg-blue-100 text-blue-700 rounded-xl font-bold text-xs hover:bg-blue-200 disabled:opacity-50 transition"
                  title="הפעל היום בלבד — ללא החלפת צלצולים קבועה">
                  {applying==='a'+t.id?'...':'📅 היום'}
                </button>
                <button
                  onClick={async()=>{
                    if(!window.confirm(`לטעון תבנית "${t.name}"? כל הצלצולים הנוכחיים יוחלפו לצמיתות!`))return;
                    setApplying(t.id);try{await onLoad(t.id);}finally{setApplying(null);}
                  }}
                  disabled={applying===t.id}
                  className="px-3 py-2 bg-violet-100 text-violet-700 rounded-xl font-bold text-xs hover:bg-violet-200 disabled:opacity-50 transition"
                  title="החלף את כל הצלצולים לצמיתות">
                  {applying===t.id?'...':'החל'}
                </button>
                <button
                  onClick={async()=>{setDeleting(t.id);try{await onDelete(t.id);}finally{setDeleting(null);}}}
                  disabled={deleting===t.id}
                  className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition">
                  {deleting===t.id?'⏳':'✕'}
                </button>
              </div>
            ))}
          </div>
      }
      <button onClick={onClose} className="w-full mt-5 py-4 rounded-[20px] font-black text-slate-400 bg-slate-50 hover:bg-slate-100">סגור</button>
    </Modal>
  );
}

// ===== Modal: Assign Playlist to Bells =====
function AssignPlaylistModal({ playlistId, playlists, bells, onClose, onAssign }) {
  const playlist = playlists.find(p => p.id === playlistId);
  const [saving, setSaving] = useState(null);

  const handleAssign = async (bellId) => {
    const bell = bells.find(b => b.id === bellId);
    const newId = bell?.playlist_id === playlistId ? null : playlistId;
    setSaving(bellId);
    try { await onAssign(bellId, newId); }
    finally { setSaving(null); }
  };

  const sortedBells = [...bells].sort((a,b) => a.time.localeCompare(b.time));

  return (
    <Modal onClose={onClose}>
      <h2 className="text-2xl font-black mb-1">🔔 שייך לצלצולים</h2>
      <p className="text-slate-400 text-sm mb-6">פלייליסט: <strong className="text-slate-700">{playlist?.name}</strong></p>
      {sortedBells.length === 0
        ? <div className="text-center py-10 text-slate-300">אין צלצולים</div>
        : <div className="space-y-2 max-h-96 overflow-y-auto">
            {sortedBells.map(b => {
              const isAssigned = b.playlist_id === playlistId;
              return (
                <button key={b.id} onClick={()=>handleAssign(b.id)} disabled={saving===b.id}
                  className={`w-full flex justify-between items-center p-4 rounded-2xl border-2 transition-all text-right ${isAssigned?'border-blue-500 bg-blue-50':'border-slate-100 bg-slate-50 hover:border-slate-300'}`}>
                  <div>
                    <div className="font-black text-sm">{b.label}</div>
                    <div className="text-xs text-slate-400">{b.time} · {DAY_LABELS.filter((_,i)=>(b.days||'0,1,2,3,4,5').split(',').includes(i.toString())).join(' ')}</div>
                  </div>
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${isAssigned?'bg-blue-600 border-blue-600 text-white':'border-slate-300'}`}>
                    {saving===b.id ? '⏳' : isAssigned ? '✓' : ''}
                  </div>
                </button>
              );
            })}
          </div>
      }
      <button onClick={onClose} className="w-full mt-5 py-4 rounded-[20px] font-black text-slate-400 bg-slate-50 hover:bg-slate-100">סגור</button>
    </Modal>
  );
}
