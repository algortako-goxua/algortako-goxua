/* Sincronización de una sola competición compartida, con escritura protegida por Auth/RLS. */
(() => {
  let db, revision = 0, busy = false, pending = false, loaded = false, dirty = false;
  const status = document.createElement('div');
  status.id = 'onlineStatus';
  status.style.cssText = 'position:fixed;bottom:5px;left:8px;z-index:60;background:#0a3622;color:white;padding:5px 9px;border-radius:8px;font:11px sans-serif;opacity:.9';
  const setStatus = (s) => { status.textContent = s; };
  const sanitize = () => {
    const { tournaments, history, customOrgLogo } = appState;
    return { tournaments, history, customOrgLogo };
  };
  const apply = (data) => {
    const view = appState.currentView, tab = appState.activeTab, lang = appState.lang;
    const active = appState.activeTournamentId, division = appState.selectedDivisionId;
    appState.tournaments = Array.isArray(data?.tournaments) ? data.tournaments : [];
    appState.history = Array.isArray(data?.history) ? data.history : [];
    appState.customOrgLogo = data?.customOrgLogo || null;
    appState.currentView = view; appState.activeTab = tab; appState.lang = lang;
    appState.activeTournamentId = appState.tournaments.some(t=>t.id===active) ? active : null;
    appState.selectedDivisionId = division;
    appState.adminPin = '';
    renderApp();
  };
  async function refresh() {
    if (busy || pending || dirty) return;
    const { data, error } = await db.from('app_state').select('data,version').eq('id',1).single();
    if (error) { setStatus('Error al leer datos'); console.error(error); return; }
    if (data.version !== revision || !loaded) { revision = data.version; apply(data.data); }
    loaded = true; setStatus(appState.isAdmin ? 'Administrador · conectado' : 'En directo');
  }
  async function flush() {
    if (!loaded || busy || !pending || !appState.isAdmin) return;
    busy = true; pending = false;
    const snapshot = sanitize();
    setStatus('Guardando…');
    const { data, error } = await db.rpc('save_app_state', { p_data:snapshot, p_version:revision });
    busy = false;
    if (error || !data?.ok) {
      dirty = true;
      setStatus('ERROR: cambios sin guardar');
      alert('No se han guardado los cambios online. No cierres esta pestaña. Puede existir una edición simultánea o haberse perdido la conexión. Exporta una copia JSON antes de recargar.');
      console.error(error || data);
      return;
    }
    revision = data.version;
    setStatus('Guardado online');
    if (pending) flush();
  }
  window.algortaSave = () => { if (!loaded || !appState.isAdmin) return; pending = true; flush(); };
  async function checkAdmin() {
    const {data:{session},error:sessionError} = await db.auth.getSession();
    if (sessionError || !session) return false;
    const {data,error} = await db.rpc('is_algorta_admin');
    if (error) { console.error('No se pudo verificar administrador',error); return false; }
    return data === true;
  }
  window.algortaToggleRole = async () => {
    if (appState.isAdmin) {
      await db.auth.signOut(); appState.isAdmin=false; renderApp(); setStatus('Vista pública');
    } else window.algortaOpenLogin();
  };
  window.algortaOpenLogin = () => {
    const modal = document.getElementById('pinModal');
    modal.querySelector('form').innerHTML = `<p class="text-sm font-semibold">Acceso de la organización</p>
      <input id="adminEmail" type="email" required placeholder="Correo electrónico" autocomplete="username" class="w-full border rounded-lg p-3">
      <input id="adminPassword" type="password" required placeholder="Contraseña" autocomplete="current-password" class="w-full border rounded-lg p-3">
      <button class="w-full bg-green-900 text-white rounded-lg p-3 font-bold" type="submit">Entrar</button>`;
    modal.querySelector('form').onsubmit = e => { e.preventDefault(); window.algortaLogin(); };
    openModal('pinModal');
  };
  window.algortaLogin = async () => {
    const email = document.getElementById('adminEmail')?.value;
    const password = document.getElementById('adminPassword')?.value;
    const {error} = await db.auth.signInWithPassword({email,password});
    if(error) { alert('No se ha podido iniciar sesión: '+error.message); return; }
    const allowed = await checkAdmin();
    if (!allowed) { await db.auth.signOut(); alert('Esta cuenta no está autorizada como administradora.'); return; }
    appState.isAdmin=true; closeModal('pinModal'); renderApp(); setStatus('Administrador · conectado');
  };
  window.addEventListener('beforeunload', e => { if(busy || pending || dirty) {e.preventDefault();e.returnValue='';} });
  window.addEventListener('DOMContentLoaded', async () => {
    document.body.appendChild(status);
    if (!window.supabase || !window.ALGORTA_SUPABASE_URL?.startsWith('https://') || window.ALGORTA_SUPABASE_ANON_KEY?.startsWith('PEGA_')) {
      setStatus('Falta configurar Supabase');
      document.getElementById('appContent').innerHTML = '<div class="bg-white rounded-xl p-6"><h2 class="font-bold text-lg">Configuración pendiente</h2><p>Introduce la URL y la clave pública de Supabase en config.js siguiendo el archivo LEEME.md.</p></div>';
      return;
    }
    db = window.supabase.createClient(window.ALGORTA_SUPABASE_URL,window.ALGORTA_SUPABASE_ANON_KEY);
    const {data:{session}} = await db.auth.getSession();
    appState.isAdmin=session ? await checkAdmin() : false;
    appState.tournaments=[];appState.history=[];appState.adminPin='';
    await refresh();
    db.channel('algorta-online').on('postgres_changes', {event:'UPDATE',schema:'public',table:'app_state',filter:'id=eq.1'},()=>refresh()).subscribe();
    db.auth.onAuthStateChange((_event,session)=>{
      if (!session) { appState.isAdmin=false; renderApp(); setStatus('Vista pública'); }
      // La verificación de permisos al entrar se realiza en algortaLogin.
    });
    // Recuperación si se pierde un evento Realtime.
    setInterval(()=>{if(document.visibilityState==='visible')refresh();},30000);
  });
})();
