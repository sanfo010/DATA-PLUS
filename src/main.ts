import './style.css'
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'

type Screen = 'home' | 'wallet' | 'activity' | 'profile' | 'reserve' | 'reserve-confirm' | 'activate' | 'activation-settings' | 'devices' | 'sessions' | 'settings' | 'notifications' | 'help' | 'terms'

type WalletEntry = {
  id: string
  kind: 'reservation' | 'activation' | 'consumption' | 'cancellation'
  amountMb: number
  status: 'completed' | 'pending' | 'cancelled' | 'failed'
  createdAt: string
  title: string
  sessionId?: string
  endedAt?: string
}

type DemoActivationSession = {
  id: string
  startedAt: string
  initialMb: number
  entryId: string
}

type DemoNotification = {
  id: string
  message: string
  createdAt: string
  read: boolean
}

type DemoWallet = {
  entries: WalletEntry[]
  activationSession: DemoActivationSession | null
  notifications: DemoNotification[]
}

type DeviceRecord = {
  id: string
  device_name: string
  platform: 'web' | 'android' | 'ios' | 'unknown'
  status: 'active' | 'inactive' | 'revoked'
  created_at: string
  last_seen_at: string | null
  revoked_at: string | null
}

type VpnSessionRecord = {
  id: string
  device_id: string
  status: 'requested' | 'authorized' | 'connecting' | 'connected' | 'interrupted' | 'stopping' | 'stopped' | 'failed'
  reserved_bytes: number
  consumed_bytes: number
  remaining_bytes: number
  created_at: string
  started_at: string | null
  stopped_at: string | null
  gateway_verified_at: string | null
}

type LabSessionRecord = {
  id: string
  user_id: string
  device_id: string
  status: 'connecting' | 'connected' | 'interrupted' | 'stopping' | 'stopped' | 'failed'
  created_at: string
  started_at: string | null
  stopped_at: string | null
  gateway_verified_at: string | null
  rx_bytes: string
  tx_bytes: string
  total_bytes: string
  last_handshake_at: string | null
  observed_at: string
}

type LabGatewayStatus = {
  available: boolean
  status: 'connected' | 'interrupted' | 'stopped' | 'unavailable'
  observedAt: string
}

const volumeOptions = [
  { mb: 500, label: '500 Mo' },
  { mb: 1024, label: '1 Go' },
  { mb: 2048, label: '2 Go' },
  { mb: 5120, label: '5 Go' },
  { mb: 10240, label: '10 Go' },
]

const icons: Record<string, string> = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M16 11h5v4h-5a2 2 0 010-4z"/><path d="M7 6V4h10v2"/>',
  activity: '<path d="M4 12h3l2-5 4 10 3-7 2 2h2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
  bell: '<path d="M18 8a6 6 0 00-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.6v.2H12V20a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1-1.8-1.8.1-.1a1.7 1.7 0 00.3-1.9A1.7 1.7 0 005 14H4v-3h1a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9l-.1-.1L8 6.2l.1.1A1.7 1.7 0 0010 6.6 1.7 1.7 0 0011 5V4h3v1a1.7 1.7 0 001 1.6 1.7 1.7 0 001.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 00-.3 1.9A1.7 1.7 0 0020 11h1v3h-1a1.7 1.7 0 00-.6 1z"/>',
  shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z"/><path d="M9 12l2 2 4-4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.4 2.4 0 114.6 1c-.8 1.1-2.3 1.4-2.3 3"/><path d="M12 17h.01"/>',
  chevron: '<path d="M9 18l6-6-6-6"/>',
  arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  wifi: '<path d="M5 12.5a10 10 0 0114 0"/><path d="M8.5 16a5 5 0 017 0"/><circle cx="12" cy="20" r="1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="M5 12l4 4L19 7"/>',
  logout: '<path d="M10 5H5v14h5"/><path d="M14 8l4 4-4 4M18 12H8"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/>',
  credit: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M3 10h18"/>',
  camera: '<path d="M14 5l1.5 2H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2h3.5L10 5z"/><circle cx="12" cy="13" r="3"/>',
  refresh: '<path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M5.6 9a7 7 0 0112-2L20 12M4 12l2.4 5a7 7 0 0012-2"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
}

const icon = (name: string, size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ''}</svg>`

const app = document.querySelector<HTMLDivElement>('#app')!
const overlayHost = () => document.querySelector<HTMLElement>('.app-shell') || app
let activeScreen: Screen = 'home'
let selectedVolumeMb = 500
let activityFilter = 'all'
let activationHistoryPeriod = 'all'
let activationHistoryStatus = 'all'
let activationPhase: 'idle' | 'checking' | 'preparing' = 'idle'
let notificationsEnabled = localStorage.getItem('dataplus_notifications') !== 'false'
let activationNotificationsEnabled = localStorage.getItem('dataplus_activation_notifications') !== 'false'
let activationConfirmationEnabled = localStorage.getItem('dataplus_activation_confirmation') !== 'false'
let accountDevices: DeviceRecord[] = []
let deviceLoadError = ''
let devicesLoading = false
let deviceLoadGeneration = 0
let accountSessions: VpnSessionRecord[] = []
let sessionLoadError = ''
let sessionsLoading = false
let sessionLoadGeneration = 0
let pendingSessionRequest: { deviceId: string; idempotencyKey: string } | null = null
let labGatewayStatus: LabGatewayStatus | null = null
let labSession: LabSessionRecord | null = null
let labError = ''
let labLoading = false
let demoWallet: DemoWallet = { entries: [], activationSession: null, notifications: [] }

const sessionStorageAdapter = {
  getItem: (key: string) => sessionStorage.getItem(key),
  setItem: (key: string, value: string) => sessionStorage.setItem(key, value),
  removeItem: (key: string) => sessionStorage.removeItem(key),
}

let rememberMe = localStorage.getItem('dataplus_remember') !== 'false'
const authStorage = rememberMe ? localStorage : sessionStorageAdapter
const supabase: SupabaseClient = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: true, storage: authStorage, autoRefreshToken: true } },
)

type Profile = {
  id: string
  full_name: string
  avatar_url: string | null
  created_at: string
  last_sign_in_at: string | null
}

let currentSession: Session | null = null
let currentProfile: Profile | null = null
let activationClockTimer: number | null = null

const profileFromSession = (session: Session): Profile => ({
  id: session.user.id,
  full_name: String(session.user.user_metadata.full_name || ''),
  avatar_url: typeof session.user.user_metadata.avatar_url === 'string'
    ? session.user.user_metadata.avatar_url
    : null,
  created_at: session.user.created_at,
  last_sign_in_at: session.user.last_sign_in_at || null,
})

const controlApiBase = import.meta.env.VITE_DATAPLUS_API_URL?.replace(/\/+$/, '')

const requestControlApi = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  if (!controlApiBase || !currentSession?.access_token) {
    throw new Error('Backend DataPlus non configuré ou session expirée.')
  }
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${currentSession.access_token}`)
  if (init.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${controlApiBase}${path}`, { ...init, headers })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null
      && 'error' in payload && typeof payload.error === 'object' && payload.error !== null
      && 'message' in payload.error && typeof payload.error.message === 'string'
      ? payload.error.message
      : 'La requête au backend DataPlus a échoué.'
    throw new Error(message)
  }
  if (typeof payload !== 'object' || payload === null || !('data' in payload)) {
    throw new Error('Réponse invalide du backend DataPlus.')
  }
  return payload.data as T
}

const localAvatarKey = (userId: string) => `dataplus_profile_avatar:${userId}`

const withLocalAvatar = (profile: Profile): Profile => ({
  ...profile,
  avatar_url: localStorage.getItem(localAvatarKey(profile.id)) || profile.avatar_url,
})

const makeLocalAvatar = async (file: File) => {
  const image = await createImageBitmap(file)
  const scale = Math.min(1, 768 / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const context = canvas.getContext('2d')
  if (!context) {
    image.close()
    throw new Error('Impossible de préparer la photo')
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  image.close()
  return canvas.toDataURL('image/jpeg', 0.82)
}

const walletStorageKey = (userId: string) => `dataplus_wallet_demo:${userId}`

const loadDemoWallet = (userId: string): DemoWallet => {
  const raw = localStorage.getItem(walletStorageKey(userId))
  if (!raw) return { entries: [], activationSession: null, notifications: [] }
  const parsed: unknown = JSON.parse(raw)
  if (
    typeof parsed !== 'object'
    || parsed === null
    || !('entries' in parsed)
    || !Array.isArray(parsed.entries)
    || !parsed.entries.every(isWalletEntry)
    || ('activationSession' in parsed && parsed.activationSession !== null && !isDemoActivationSession(parsed.activationSession))
    || ('notifications' in parsed && (!Array.isArray(parsed.notifications) || !parsed.notifications.every(isDemoNotification)))
  ) {
    throw new Error('Données locales du portefeuille invalides')
  }
  const wallet = parsed as Partial<DemoWallet> & Pick<DemoWallet, 'entries'>
  return {
    entries: wallet.entries,
    activationSession: wallet.activationSession || null,
    notifications: wallet.notifications || [],
  }
}

const isWalletEntry = (value: unknown): value is WalletEntry => {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry.id === 'string'
    && ['reservation', 'activation', 'consumption', 'cancellation'].includes(String(entry.kind))
    && typeof entry.amountMb === 'number'
    && Number.isSafeInteger(entry.amountMb)
    && entry.amountMb > 0
    && ['completed', 'pending', 'cancelled', 'failed'].includes(String(entry.status))
    && typeof entry.createdAt === 'string'
    && !Number.isNaN(Date.parse(entry.createdAt))
    && typeof entry.title === 'string'
    && (entry.sessionId === undefined || typeof entry.sessionId === 'string')
    && (entry.endedAt === undefined || (typeof entry.endedAt === 'string' && !Number.isNaN(Date.parse(entry.endedAt))))
}

const isDemoActivationSession = (value: unknown): value is DemoActivationSession => {
  if (typeof value !== 'object' || value === null) return false
  const session = value as Record<string, unknown>
  return typeof session.id === 'string'
    && typeof session.startedAt === 'string'
    && !Number.isNaN(Date.parse(session.startedAt))
    && typeof session.initialMb === 'number'
    && Number.isSafeInteger(session.initialMb)
    && session.initialMb > 0
    && typeof session.entryId === 'string'
}

const isDemoNotification = (value: unknown): value is DemoNotification => {
  if (typeof value !== 'object' || value === null) return false
  const notification = value as Record<string, unknown>
  return typeof notification.id === 'string'
    && typeof notification.message === 'string'
    && typeof notification.createdAt === 'string'
    && !Number.isNaN(Date.parse(notification.createdAt))
    && typeof notification.read === 'boolean'
}

const saveDemoWallet = (wallet: Pick<DemoWallet, 'entries'> & Partial<Omit<DemoWallet, 'entries'>>) => {
  if (!currentSession) throw new Error('Aucun compte actif')
  localStorage.setItem(walletStorageKey(currentSession.user.id), JSON.stringify(wallet))
  demoWallet = {
    entries: wallet.entries,
    activationSession: wallet.activationSession || null,
    notifications: wallet.notifications || [],
  }
}

const restoreDemoWallet = () => {
  if (!currentSession) {
    demoWallet = { entries: [], activationSession: null, notifications: [] }
    return false
  }
  try {
    demoWallet = loadDemoWallet(currentSession.user.id)
    return true
  } catch (error) {
    console.error('Could not load local demo wallet:', error)
    demoWallet = { entries: [], activationSession: null, notifications: [] }
    showToast('Les données locales du portefeuille sont illisibles. Un portefeuille de démonstration vide est affiché.', 'error')
    return false
  }
}

const walletTotals = () => {
  const reservations = demoWallet.entries
    .filter((entry) => entry.kind === 'reservation' && entry.status === 'completed')
    .reduce((total, entry) => total + entry.amountMb, 0)
  const cancellations = demoWallet.entries
    .filter((entry) => entry.kind === 'cancellation' && entry.status === 'completed')
    .reduce((total, entry) => total + entry.amountMb, 0)
  const consumed = demoWallet.entries
    .filter((entry) => entry.kind === 'consumption' && entry.status === 'completed')
    .reduce((total, entry) => total + entry.amountMb, 0)
  const reserved = Math.max(0, reservations - cancellations)
  return { reserved, consumed, available: Math.max(0, reserved - consumed) }
}

const sessionConsumption = (sessionId: string) => demoWallet.entries
  .filter((entry) => entry.kind === 'consumption' && entry.status === 'completed' && entry.sessionId === sessionId)
  .reduce((total, entry) => total + entry.amountMb, 0)

const durationLabel = (startedAt: string, endedAt = new Date().toISOString()) => {
  const seconds = Math.max(0, Math.floor((Date.parse(endedAt) - Date.parse(startedAt)) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  if (hours) return `${hours} h ${minutes.toString().padStart(2, '0')} min`
  if (minutes) return `${minutes} min ${remainingSeconds.toString().padStart(2, '0')} s`
  return `${remainingSeconds} s`
}

const addDemoNotification = (message: string) => {
  const notification: DemoNotification = {
    id: crypto.randomUUID(),
    message,
    createdAt: new Date().toISOString(),
    read: false,
  }
  try {
    saveDemoWallet({ ...demoWallet, notifications: [notification, ...demoWallet.notifications].slice(0, 100) })
    if (notificationsEnabled && activationNotificationsEnabled) showToast(message)
  } catch (error) {
    console.error('Could not save demo notification:', error)
    showToast('La simulation est enregistrée, mais sa notification n’a pas pu être sauvegardée.', 'error')
  }
}

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds))

const formatData = (mb: number) => {
  if (mb === 0) return '0 Go'
  if (mb < 1024) return `${mb} Mo`
  return `${(mb / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} Go`
}

const formatDate = (date: string) =>
  new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date))

const getProfile = async (session: Session) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .maybeSingle()
  if (error) throw error
  if (!data) return withLocalAvatar(profileFromSession(session))
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ last_sign_in_at: new Date().toISOString() })
    .eq('id', session.user.id)
  if (updateError) console.error('Could not update profile last sign-in:', updateError)
  return withLocalAvatar(data as Profile)
}

const splash = () => {
  app.innerHTML = `
    <main class="splash">
      <div class="splash-glow"></div>
      <div class="brand-mark splash-mark">
        <span class="brand-d">${icon('wifi', 26)}</span><b>Data</b><strong>Plus</strong>
      </div>
      <p>Prépare ta connexion.<br>Profite partout.</p>
      <div class="splash-line"><span></span></div>
    </main>`
  setTimeout(async () => {
    const { data } = await supabase.auth.getSession()
    if (data.session) {
      currentSession = data.session
      restoreDemoWallet()
      try {
        currentProfile = await getProfile(data.session)
      } catch (error) {
        console.error('Could not load DataPlus profile:', error)
        currentProfile = profileFromSession(data.session)
      }
      renderApp()
    } else {
      onboarding()
    }
  }, 2200)
}

let slide = 0
const onboarding = () => {
  const slides = [
    { eyebrow: 'CONNEXION PRÉPARÉE', title: 'Réserve chez toi', copy: 'Prépare ton volume de données depuis ta connexion habituelle.', art: 'orbit' },
    { eyebrow: 'LIBERTÉ DE MOUVOIR', title: 'Emporte-la partout', copy: 'Accède à ton solde mobile quand tu es en déplacement.', art: 'mobile' },
    { eyebrow: 'SOUS CONTRÔLE', title: 'Garde la maîtrise', copy: 'Suivi clair, données disponibles et historique toujours à portée.', art: 'wallet' },
  ]
  const s = slides[slide]
  app.innerHTML = `
    <main class="onboarding">
      <div class="onboarding-top">
        <div class="brand-mark small"><span class="brand-d">${icon('wifi', 18)}</span><b>Data</b><strong>Plus</strong></div>
        <button class="text-button" id="skip">Passer</button>
      </div>
      <div class="onboard-art ${s.art}">
        ${artMarkup(s.art)}
      </div>
      <div class="onboard-copy">
        <span class="eyebrow">${s.eyebrow}</span>
        <h1>${s.title}</h1>
        <p>${s.copy}</p>
      </div>
      <div class="onboard-footer">
        <div class="dots">${slides.map((_, i) => `<span class="${i === slide ? 'active' : ''}"></span>`).join('')}</div>
        <button class="round-next" id="next" aria-label="Suivant">${icon('arrow', 23)}</button>
      </div>
    </main>`
  document.querySelector('#skip')?.addEventListener('click', auth)
  document.querySelector('#next')?.addEventListener('click', () => slide < 2 ? (++slide, onboarding()) : auth())
}

const artMarkup = (art: string) => {
  if (art === 'orbit') return `
    <div class="orbit-ring ring-one"></div><div class="orbit-ring ring-two"></div>
    <div class="orbit-core">${icon('wifi', 38)}</div>
    <div class="orbit-dot dot-a"></div><div class="orbit-dot dot-b"></div>`
  if (art === 'mobile') return `
    <div class="phone"><div class="phone-notch"></div><div class="phone-signal">${icon('wifi', 32)}</div><div class="phone-bars"><span></span><span></span><span></span></div></div>
    <div class="float-badge badge-a">${icon('check', 16)} Prêt</div>`
  return `
    <div class="mini-wallet"><div class="wallet-top"><span>Exemple · disponible</span><b>0 Go</b></div><div class="wallet-wave"></div></div>
    <div class="float-badge badge-b">${icon('clock', 16)} Historique</div>`
}

const auth = () => {
  app.innerHTML = `
    <main class="auth-screen">
      <div class="auth-orb"></div>
      <div class="brand-mark auth-logo"><span class="brand-d">${icon('wifi', 20)}</span><b>Data</b><strong>Plus</strong></div>
      <div class="auth-card">
        <span class="eyebrow">BON RETOUR</span>
        <h1>Heureux de te<br>retrouver.</h1>
        <form id="login-form">
          <label>Adresse e-mail<div class="field">${icon('user', 19)}<input id="login-email" type="email" placeholder="amina@example.com" autocomplete="email" aria-label="Adresse e-mail"></div></label>
          <label>Mot de passe<div class="field">${icon('lock', 19)}<input id="login-password" type="password" placeholder="Votre mot de passe" autocomplete="current-password" aria-label="Mot de passe"><button type="button" class="password-toggle" data-for="login-password" aria-label="Afficher le mot de passe">Afficher</button></div></label>
          <label class="remember-row"><input id="remember-me" type="checkbox" ${rememberMe ? 'checked' : ''}> Se souvenir de moi</label>
          <p class="form-error" id="login-error" role="alert"></p>
          <button type="button" class="forgot">Mot de passe oublié ?</button>
          <button class="primary full" type="submit"><span>Se connecter</span>${icon('arrow', 19)}</button>
        </form>
        <p class="auth-switch">Nouveau sur DataPlus ? <button id="signup">Créer un compte</button></p>
      </div>
    </main>`
  document.querySelector('#login-form')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const email = (document.querySelector('#login-email') as HTMLInputElement).value.trim()
    const password = (document.querySelector('#login-password') as HTMLInputElement).value
    const errorEl = document.querySelector('#login-error')!
    errorEl.textContent = ''
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errorEl.textContent = 'Saisis une adresse électronique valide.'
      return
    }
    if (!password) {
      errorEl.textContent = 'Saisis ton mot de passe.'
      return
    }
    rememberMe = (document.querySelector('#remember-me') as HTMLInputElement).checked
    localStorage.setItem('dataplus_remember', String(rememberMe))
    setAuthLoading('#login-form', true)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    setAuthLoading('#login-form', false)
    if (error) {
      errorEl.textContent = error.message.includes('Invalid login credentials')
        ? 'Adresse électronique ou mot de passe incorrect.'
        : error.status === 429
        ? 'Trop de tentatives. Attends quelques instants puis réessaie.'
        : 'Impossible de se connecter. Vérifie ta connexion puis réessaie.'
      return
    }
    currentSession = data.session
    restoreDemoWallet()
    if (currentSession) {
      try {
        currentProfile = await getProfile(currentSession)
      } catch (error) {
        console.error('Could not load DataPlus profile:', error)
        currentProfile = profileFromSession(currentSession)
      }
    }
    renderApp()
  })
  document.querySelector('#signup')?.addEventListener('click', signup)
  document.querySelector('.forgot')?.addEventListener('click', () => passwordReset())
  bindPasswordToggles()
}

const signup = () => {
  app.innerHTML = `
    <main class="auth-screen">
      <div class="auth-orb"></div>
      <div class="brand-mark auth-logo"><span class="brand-d">${icon('wifi', 20)}</span><b>Data</b><strong>Plus</strong></div>
      <div class="auth-card">
        <span class="eyebrow">NOUVEAU COMPTE</span><h1>Bienvenue sur<br>DataPlus.</h1>
        <form id="signup-form">
          <label>Nom complet<div class="field">${icon('user', 19)}<input id="signup-name" placeholder="Amina Diallo" autocomplete="name" aria-label="Nom complet"></div></label>
          <label>Adresse e-mail<div class="field">${icon('credit', 19)}<input id="signup-email" type="email" placeholder="amina@example.com" autocomplete="email" aria-label="Adresse e-mail"></div></label>
          <label>Mot de passe<div class="field">${icon('lock', 19)}<input id="signup-password" type="password" placeholder="8 caractères minimum" autocomplete="new-password" aria-label="Mot de passe"><button type="button" class="password-toggle" data-for="signup-password" aria-label="Afficher le mot de passe">Afficher</button></div></label>
          <label>Confirmation<div class="field">${icon('lock', 19)}<input id="signup-confirm" type="password" placeholder="Retaper le mot de passe" autocomplete="new-password" aria-label="Confirmation du mot de passe"></div></label>
          <p class="form-error" id="signup-error" role="alert"></p>
          <button class="primary full" type="submit"><span>Créer mon compte</span>${icon('arrow', 19)}</button>
        </form>
        <p class="auth-switch">Déjà inscrit ? <button id="signin">Se connecter</button></p>
      </div>
    </main>`
  document.querySelector('#signup-form')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const name = (document.querySelector('#signup-name') as HTMLInputElement).value.trim()
    const email = (document.querySelector('#signup-email') as HTMLInputElement).value.trim()
    const password = (document.querySelector('#signup-password') as HTMLInputElement).value
    const confirm = (document.querySelector('#signup-confirm') as HTMLInputElement).value
    const errorEl = document.querySelector('#signup-error')!
    errorEl.textContent = ''
    if (name.length < 2) { errorEl.textContent = 'Indique ton nom complet.'; return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errorEl.textContent = 'Saisis une adresse électronique valide.'; return }
    if (password.length < 8) { errorEl.textContent = 'Le mot de passe doit contenir au moins 8 caractères.'; return }
    if (password !== confirm) { errorEl.textContent = 'Les deux mots de passe ne correspondent pas.'; return }
    setAuthLoading('#signup-form', true)
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    })
    setAuthLoading('#signup-form', false)
    if (error) {
      const authError = error as Error & { code?: string; status?: number }
      const code = authError.code
      if (code === 'over_email_send_rate_limit' || authError.status === 429) {
        errorEl.textContent = 'Supabase limite actuellement l’envoi des e-mails. Attends quelques minutes, puis réessaie.'
      } else if (code === 'email_provider_disabled') {
        errorEl.textContent = 'Les inscriptions par e-mail sont désactivées dans Supabase. Active le fournisseur Email dans Authentication > Providers.'
      } else if (error.message.toLowerCase().includes('already registered') || code === 'user_already_exists') {
        errorEl.textContent = 'Cette adresse électronique est déjà utilisée. Essaie de te connecter.'
      } else if (code === 'weak_password' || error.message.toLowerCase().includes('password')) {
        errorEl.textContent = 'Le mot de passe ne respecte pas les règles de sécurité Supabase.'
      } else if (code === 'email_address_invalid' || error.message.toLowerCase().includes('email')) {
        errorEl.textContent = 'Cette adresse électronique est refusée par le service. Vérifie-la.'
      } else {
        errorEl.textContent = `Impossible de créer le compte : ${error.message}`
      }
      return
    }
    if (data.session) {
      currentSession = data.session
      restoreDemoWallet()
      try {
        currentProfile = await getProfile(data.session)
      } catch (error) {
        console.error('Could not load DataPlus profile:', error)
        currentProfile = profileFromSession(data.session)
      }
      openModal('Compte créé', 'Ton compte DataPlus est prêt. Bienvenue.', 'Commencer')
      setTimeout(renderApp, 1800)
    } else {
      openModal('Vérifie tes e-mails', 'Un lien de confirmation a été envoyé à ton adresse électronique.', 'OK')
      setTimeout(auth, 1800)
    }
  })
  document.querySelector('#signin')?.addEventListener('click', auth)
  bindPasswordToggles()
}

const bindPasswordToggles = () => {
  document.querySelectorAll<HTMLButtonElement>('.password-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.querySelector<HTMLInputElement>(`#${button.dataset.for}`)
      if (!input) return
      const show = input.type === 'password'
      input.type = show ? 'text' : 'password'
      button.textContent = show ? 'Masquer' : 'Afficher'
      button.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe')
    })
  })
}

const setAuthLoading = (formSelector: string, loading: boolean) => {
  const form = document.querySelector<HTMLFormElement>(formSelector)
  if (!form) return
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')
  if (!button) return
  button.disabled = loading
  button.classList.toggle('loading', loading)
  if (loading) button.querySelector('span')!.textContent = 'Chargement…'
  else {
    const labels: Record<string, string> = {
      '#login-form': 'Se connecter',
      '#signup-form': 'Créer mon compte',
      '#reset-form': 'Envoyer le lien',
      '#new-password-form': 'Confirmer',
    }
    button.querySelector('span')!.textContent = labels[formSelector] || 'Continuer'
  }
}

const passwordReset = (returnToApp = false) => {
  app.innerHTML = `
    <main class="auth-screen">
      <div class="auth-orb"></div>
      <div class="brand-mark auth-logo"><span class="brand-d">${icon('wifi', 20)}</span><b>Data</b><strong>Plus</strong></div>
      <div class="auth-card reset-card">
        <button class="back-button" id="reset-back">${icon('chevron', 18)} Retour</button>
        <span class="eyebrow">RÉINITIALISATION</span>
        <h1>Mot de passe<br>oublié ?</h1>
        <p class="reset-copy">Saisis ton adresse électronique. Nous t’enverrons un lien sécurisé.</p>
        <form id="reset-form">
          <label>Adresse e-mail<div class="field">${icon('credit', 19)}<input id="reset-email" type="email" placeholder="amina@example.com" autocomplete="email" aria-label="Adresse e-mail"></div></label>
          <p class="form-error" id="reset-error" role="alert"></p>
          <button class="primary full" type="submit"><span>Envoyer le lien</span>${icon('arrow', 19)}</button>
        </form>
      </div>
    </main>`
  document.querySelector('#reset-back')?.addEventListener('click', () => returnToApp ? renderApp() : auth())
  document.querySelector('#reset-form')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const email = (document.querySelector('#reset-email') as HTMLInputElement).value.trim()
    const errorEl = document.querySelector('#reset-error')!
    errorEl.textContent = ''
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errorEl.textContent = 'Saisis une adresse électronique valide.'
      return
    }
    setAuthLoading('#reset-form', true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/`,
    })
    setAuthLoading('#reset-form', false)
    if (error) {
      errorEl.textContent = 'Impossible d’envoyer le lien. Vérifie ta connexion puis réessaie.'
      return
    }
    app.innerHTML = `
      <main class="auth-screen">
        <div class="auth-orb"></div>
        <div class="auth-card reset-success">
          <div class="success-icon">${icon('check', 28)}</div>
          <span class="eyebrow">E-MAIL ENVOYÉ</span>
          <h1>Vérifie ta<br>boîte e-mail.</h1>
          <p>Le lien de réinitialisation a été envoyé à <b>${escapeHtml(email)}</b>.</p>
          <button class="primary full" id="reset-login">Retour à la connexion</button>
        </div>
      </main>`
    document.querySelector('#reset-login')?.addEventListener('click', () => returnToApp ? renderApp() : auth())
  })
}

const renderApp = () => {
  if (!currentSession) {
    auth()
    return
  }
  app.innerHTML = `
    <main class="app-shell">
      <div class="app-content" id="screen">${renderScreen()}</div>
      <nav class="bottom-nav" aria-label="Navigation principale">
        ${navItem('home', 'Accueil')}
        ${navItem('wallet', 'Portefeuille')}
        ${navItem('activity', 'Activité')}
        ${navItem('profile', 'Profil')}
      </nav>
    </main>`
  document.querySelectorAll('.nav-item').forEach((item) => item.addEventListener('click', () => {
    navigate((item as HTMLElement).dataset.screen as Screen)
  }))
  bindAppActions()
  if (activationClockTimer !== null) window.clearInterval(activationClockTimer)
  activationClockTimer = window.setInterval(() => {
    if (!demoWallet.activationSession) return
    const duration = durationLabel(demoWallet.activationSession.startedAt)
    document.querySelectorAll<HTMLElement>('[data-session-clock]').forEach((element) => { element.textContent = duration })
  }, 1000)
}

const navItem = (name: string, label: string) =>
  `<button class="nav-item ${name === activeScreen || (name === 'home' && ['activate', 'activation-settings'].includes(activeScreen)) ? 'active' : ''}" data-screen="${name}">${icon(name)}<span>${label}</span></button>`

const renderScreen = () => {
  if (activeScreen === 'wallet') return walletScreen()
  if (activeScreen === 'activity') return activityScreen()
  if (activeScreen === 'profile') return profileScreen()
  if (activeScreen === 'reserve') return reserveScreen()
  if (activeScreen === 'reserve-confirm') return reservationConfirmationScreen()
  if (activeScreen === 'activate') return activationScreen()
  if (activeScreen === 'activation-settings') return activationSettingsScreen()
  if (activeScreen === 'devices') return devicesScreen()
  if (activeScreen === 'sessions') return sessionsScreen()
  if (activeScreen === 'settings') return settingsScreen()
  if (activeScreen === 'notifications') return notificationsScreen()
  if (activeScreen === 'help') return helpScreen()
  if (activeScreen === 'terms') return termsScreen()
  return homeScreen()
}

const subpageHeader = (title: string, back = 'back', refreshAction?: 'reload-devices' | 'reload-sessions') => `
  <header class="page-header subpage-header">
    <button class="back-button" data-action="${back}">${icon('chevron', 18)} Retour</button>
    <h1>${title}</h1>
    ${refreshAction
      ? `<button class="icon-button backend-refresh" data-action="${refreshAction}" aria-label="Actualiser" ${((refreshAction === 'reload-devices' && devicesLoading) || (refreshAction === 'reload-sessions' && sessionsLoading)) ? 'disabled' : ''}>${icon('refresh', 18)}</button>`
      : '<span class="header-spacer"></span>'}
  </header>`

const reserveScreen = () => `
  <section class="page reserve-page">
    ${subpageHeader('Réserver des données', 'wallet')}
    <div class="demo-notice">${icon('help', 16)} Simulation uniquement · aucun achat ni accès Internet</div>
    <p class="screen-intro">Choisis un volume à ajouter à ton portefeuille de démonstration.</p>
    <div class="volume-options">
      ${volumeOptions.map((option) => `
        <button class="volume-option ${selectedVolumeMb === option.mb ? 'selected' : ''}" data-action="select-volume" data-volume-mb="${option.mb}">
          <span class="volume-mark">${icon(selectedVolumeMb === option.mb ? 'check' : 'plus', 18)}</span>
          <b>${option.label}</b>
          <span class="volume-caption">${option.mb < 1024 ? 'Mégaoctets' : 'Gigaoctets'}</span>
        </button>`).join('')}
    </div>
    <div class="reservation-summary">
      <span>Solde actuel <b>${formatData(walletTotals().available)}</b></span>
      <span>Après simulation <b>${formatData(walletTotals().available + selectedVolumeMb)}</b></span>
    </div>
    <button class="primary full" data-action="review-reservation">${icon('arrow', 19)} Continuer</button>
    <p class="disclaimer">Cette opération est enregistrée uniquement dans ce navigateur pour la démonstration. Elle n’achète aucune donnée mobile.</p>
  </section>`

const reservationConfirmationScreen = () => `
  <section class="page reserve-page">
    ${subpageHeader('Confirmation', 'back-reserve')}
    <div class="confirm-illustration">${icon('wifi', 36)}</div>
    <span class="eyebrow">RÉSERVATION DE DÉMONSTRATION</span>
    <h2 class="confirm-title">Ajouter ${formatData(selectedVolumeMb)} ?</h2>
    <div class="reservation-summary confirm-summary">
      <span>Volume sélectionné <b>${formatData(selectedVolumeMb)}</b></span>
      <span>Solde actuel <b>${formatData(walletTotals().available)}</b></span>
      <span>Nouveau solde simulé <b>${formatData(walletTotals().available + selectedVolumeMb)}</b></span>
    </div>
    <div class="demo-notice">${icon('help', 16)} Pas de connexion Internet réelle associée</div>
    <button class="primary full confirm-button" data-action="confirm-reservation">${icon('check', 19)} Confirmer la simulation</button>
    <button class="text-button cancel-reservation" data-action="reserve">Revenir au choix</button>
  </section>`

const activationScreen = () => {
  const totals = walletTotals()
  const session = demoWallet.activationSession
  const consumed = session ? sessionConsumption(session.id) : totals.consumed
  const initial = session?.initialMb ?? totals.reserved
  const remaining = session ? Math.max(0, session.initialMb - consumed) : totals.available
  const percent = initial ? Math.min(100, Math.round(consumed / initial * 100)) : 0
  const latestActivation = demoWallet.entries.find((entry) => entry.kind === 'activation')
  const status = activationPhase === 'checking'
    ? 'Vérification du portefeuille'
    : activationPhase === 'preparing'
      ? 'Préparation de la simulation'
      : session
        ? 'En attente du réseau réel'
        : totals.available === 0
          ? totals.reserved > 0 ? 'Crédit épuisé' : 'Aucune donnée disponible'
          : latestActivation?.status === 'failed' ? 'Activation impossible'
            : 'Prêt à préparer'
  const statusCopy = activationPhase === 'checking'
    ? 'Vérification locale du solde…'
    : activationPhase === 'preparing'
      ? 'Préparation de votre session de démonstration…'
      : session
        ? 'La simulation est prête, mais aucun réseau ni accès Internet réel n’est connecté.'
        : totals.available === 0
          ? totals.reserved > 0 ? 'Ajoute des données de démonstration pour préparer une session.' : 'Réserve d’abord un volume dans ton portefeuille.'
          : latestActivation?.status === 'failed'
            ? 'La dernière préparation a été interrompue. Tu peux réessayer.'
            : 'Tes données de démonstration sont disponibles pour tester le suivi.'
  const statusTone = session ? 'waiting' : totals.available === 0 || latestActivation?.status === 'failed' ? 'muted' : 'ready'
  const activationEntries = demoWallet.entries
    .filter((entry) => entry.kind === 'activation')
    .filter((entry) => activationHistoryStatus === 'all' || entry.status === activationHistoryStatus)
    .filter((entry) => activationHistoryPeriod === 'all'
      || Date.now() - Date.parse(entry.createdAt) <= Number(activationHistoryPeriod) * 24 * 60 * 60 * 1000)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const buttonBusy = activationPhase !== 'idle'
  return `
  <section class="page activation-page">
    <header class="page-header"><h1>Activer mes données</h1><button class="icon-button" data-action="activation-settings" aria-label="Paramètres de connexion">${icon('settings', 20)}</button></header>
    <div class="demo-notice">${icon('help', 16)} Simulation uniquement · aucune connexion Internet réelle</div>
    <article class="activation-hero">
      <div class="activation-orbit">${icon(session ? 'clock' : 'wifi', 30)}</div>
      <span class="eyebrow">ÉTAT DE LA SESSION</span>
      <h2 class="activation-status ${statusTone}">${status}</h2>
      <p>${statusCopy}</p>
      ${session ? `<span class="session-live">${icon('clock', 15)} Simulation en cours · <b data-session-clock>${durationLabel(session.startedAt)}</b></span>` : ''}
    </article>
    <div class="activation-stats">
      <article><span>Disponible</span><b>${formatData(totals.available)}</b></article>
      <article><span>Réservé au total</span><b>${formatData(totals.reserved)}</b></article>
      <article><span>Consommé</span><b>${formatData(totals.consumed)}</b></article>
    </div>
    ${session ? `
      <article class="consumption-card">
        <div class="consumption-head"><div><span class="eyebrow">SUIVI DE LA SIMULATION</span><h2>${formatData(remaining)} <small>restants</small></h2></div><div class="consumption-ring" style="--consumed:${percent}%"><b>${percent}%</b></div></div>
        <div class="consumption-progress"><span style="width:${percent}%"></span></div>
        <div class="consumption-labels"><span>Départ ${formatData(initial)}</span><span>Simulé ${formatData(consumed)}</span></div>
        <div class="session-meta"><span>Début</span><b>${formatDate(session.startedAt)}</b><span>Durée</span><b data-session-clock>${durationLabel(session.startedAt)}</b></div>
      </article>
      <button class="primary full consume-demo-button" data-action="simulate-consumption">${icon('activity', 19)} Simuler 100 Mo consommés</button>
      <div class="activation-actions">
        <button class="secondary" data-action="simulate-interruption">${icon('close', 18)} Simuler une interruption</button>
        <button class="secondary" data-action="deactivate">${icon('lock', 18)} Désactiver</button>
      </div>
      <p class="disclaimer">La consommation est simulée manuellement et enregistrée localement. Aucune donnée réelle n’est transférée.</p>
    ` : `
      <button class="primary full activation-button" data-action="activation-submit" ${buttonBusy ? 'disabled' : ''}>
        ${buttonBusy ? '<span class="activation-spinner"></span>' : icon('wifi', 20)}
        ${activationPhase === 'checking' ? 'Vérification…' : activationPhase === 'preparing' ? 'Préparation…' : 'Activer mes données'}
      </button>
      <button class="secondary full" data-action="wallet">${icon('wallet', 19)} Gérer mon portefeuille</button>
      <p class="disclaimer">L’activation prépare uniquement une session de démonstration en attente du futur service réseau. Elle ne crée aucune connexion.</p>
    `}
    <section class="section-block activation-history">
      <div class="section-title"><h2>Historique des activations</h2><span>${activationEntries.length}</span></div>
      <div class="activation-filters">
        <label>Période<select data-activation-filter="period"><option value="all" ${activationHistoryPeriod === 'all' ? 'selected' : ''}>Tout</option><option value="7" ${activationHistoryPeriod === '7' ? 'selected' : ''}>7 jours</option><option value="30" ${activationHistoryPeriod === '30' ? 'selected' : ''}>30 jours</option></select></label>
        <label>Statut<select data-activation-filter="status"><option value="all" ${activationHistoryStatus === 'all' ? 'selected' : ''}>Tous</option><option value="pending" ${activationHistoryStatus === 'pending' ? 'selected' : ''}>En attente</option><option value="completed" ${activationHistoryStatus === 'completed' ? 'selected' : ''}>Terminées</option><option value="cancelled" ${activationHistoryStatus === 'cancelled' ? 'selected' : ''}>Désactivées</option><option value="failed" ${activationHistoryStatus === 'failed' ? 'selected' : ''}>Interrompues</option></select></label>
      </div>
      ${activationEntries.length
        ? `<div class="wallet-entries">${activationEntries.map((entry) => activationHistoryItem(entry)).join('')}</div>`
        : `<div class="empty-state compact-empty"><span>${icon('clock', 22)}</span><b>${demoWallet.entries.some((entry) => entry.kind === 'activation') ? 'Aucune activation dans ce filtre' : 'Aucune activation pour l’instant'}</b><small>Les sessions de démonstration s’afficheront ici.</small></div>`}
    </section>
  </section>`
}

const activationHistoryItem = (entry: WalletEntry) => {
  const consumed = entry.sessionId ? sessionConsumption(entry.sessionId) : 0
  const elapsed = durationLabel(entry.createdAt, entry.endedAt)
  return `<button class="activation-history-item" data-action="entry-detail" data-entry-id="${escapeHtml(entry.id)}">
    <span class="activity-icon ${entry.status === 'pending' ? '' : 'positive'}">${icon(entry.status === 'failed' ? 'close' : 'wifi', 18)}</span>
    <span class="activity-copy"><b>${escapeHtml(entry.title)}</b><span>${formatDate(entry.createdAt)} · ${entryStatusLabel(entry)}</span><small>${formatData(consumed)} simulés · ${elapsed}</small></span>
    ${icon('chevron', 17)}
  </button>`
}

const activationSettingsScreen = () => `
  <section class="page activation-settings-page">
    ${subpageHeader('Connexion & activation', 'activate')}
    <div class="demo-notice">${icon('help', 16)} Préférences de démonstration · aucun réseau réel</div>
    <div class="settings-group">
      <span class="eyebrow">PRÉFÉRENCES D’ACTIVATION</span>
      <label class="settings-toggle"><span><b>Confirmation manuelle</b><small>Confirmer avant chaque préparation</small></span><input type="checkbox" data-action="toggle-activation-confirmation" ${activationConfirmationEnabled ? 'checked' : ''}></label>
      <label class="settings-toggle"><span><b>Alertes de consommation</b><small>Seuils 50 %, 80 % et crédit épuisé</small></span><input type="checkbox" data-action="toggle-activation-notifications" ${activationNotificationsEnabled ? 'checked' : ''}></label>
      <div class="settings-row"><span><b>Connexion automatique</b><small>Indisponible tant que le service réseau n’est pas opérationnel</small></span>${icon('lock', 18)}</div>
    </div>
    <div class="help-card"><span class="row-icon">${icon('wifi', 20)}</span><div><b>Comment fonctionne la simulation ?</b><p>Une activation crée une session locale en attente du réseau réel. Tu peux simuler manuellement la consommation, une interruption ou la désactivation. Rien n’est débité deux fois et aucune connexion Internet n’est établie.</p></div></div>
    <button class="primary full" data-action="activation-submit">${icon('wifi', 19)} Préparer une activation</button>
  </section>`

const backendErrorMessage = (message: string) => {
  const lowered = message.toLocaleLowerCase('fr-FR')
  if (lowered.includes('could not find the table') || lowered.includes('does not exist') || lowered.includes('schema cache')) {
    return 'Le module appareils et sessions n’est pas encore installé dans Supabase. Applique la migration 202611231700_create_devices_and_vpn_sessions.sql puis réessaie.'
  }
  if (lowered.includes('failed to fetch') || lowered.includes('network')) {
    return 'Le service Supabase est momentanément inaccessible. Vérifie ta connexion puis réessaie.'
  }
  return message
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = error.message
    if (typeof message === 'string') return message
    if (message instanceof Error) return message.message
  }
  return fallback
}

const backendErrorPanel = (message: string, action: string) => `
  <div class="backend-error" role="alert">
    <span>${icon('help', 20)}</span>
    <p>${escapeHtml(backendErrorMessage(message))}</p>
    <button class="secondary" data-action="${action}">${icon('refresh', 17)} Réessayer</button>
  </div>`

const devicesScreen = () => `
  <section class="page backend-page devices-page">
    ${subpageHeader('Mes appareils', 'profile', 'reload-devices')}
    <div class="demo-notice">${icon('shield', 16)} Registre de compte · aucune clé VPN enregistrée</div>
    <p class="screen-intro">Gère les navigateurs et appareils associés à ton compte DataPlus.</p>
    ${deviceLoadError ? backendErrorPanel(deviceLoadError, 'reload-devices') : ''}
    ${devicesLoading ? `<div class="backend-loading"><span class="activation-spinner"></span><b>Chargement des appareils…</b></div>` : ''}
    ${!devicesLoading && !deviceLoadError ? accountDevices.length
      ? `<div class="device-list">${accountDevices.map((device) => `
        <article class="device-card">
          <span class="device-icon">${icon(device.platform === 'web' ? 'home' : 'user', 21)}</span>
          <div class="device-copy"><b>${escapeHtml(device.device_name)}</b><span>${devicePlatformLabel(device.platform)} · ajouté le ${formatDate(device.created_at)}</span><small class="device-status ${device.status}">${deviceStatusLabel(device.status)}</small></div>
          ${device.status !== 'revoked' ? `<button class="icon-button device-revoke" data-action="revoke-device" data-device-id="${escapeHtml(device.id)}" aria-label="Révoquer ${escapeHtml(device.device_name)}">${icon('trash', 18)}</button>` : ''}
        </article>`).join('')}</div>`
      : `<div class="empty-state"><span>${icon('user', 22)}</span><b>Aucun appareil enregistré</b><small>Ajoute cet appareil au registre de ton compte.</small></div>` : ''}
    <button class="primary full device-add" data-action="register-device" ${devicesLoading || deviceLoadError ? 'disabled' : ''}>${icon('plus', 19)} Enregistrer cet appareil</button>
    <div class="help-card"><span class="row-icon">${icon('lock', 20)}</span><div><b>Limite de cette étape</b><p>Cette action inscrit un appareil dans le compte, mais ne prouve pas son identité cryptographique. Aucune clé privée/public WireGuard n’est créée ni stockée.</p></div></div>
  </section>`

const sessionsScreen = () => {
  const activeDevices = accountDevices.filter((device) => device.status === 'active')
  return `
  <section class="page backend-page sessions-page">
    ${subpageHeader('Sessions DataPlus', 'profile', 'reload-sessions')}
    <div class="demo-notice">${icon('help', 16)} Registre de contrôle · indépendant du laboratoire VPN</div>
    <section class="lab-session-card">
      <div class="demo-notice">${icon('shield', 16)} Laboratoire VPN — connexion de test uniquement</div>
      <p>Un tunnel privé local est créé dans WSL pour valider la passerelle. L’appareil du compte autorise la demande; le pair réseau reste le client de test WSL. Aucun accès Internet ni débit du portefeuille n’est fourni.</p>
      <div class="lab-gateway-state"><span class="status-dot ${labGatewayStatus?.available ? 'available' : ''}"></span>
        ${labLoading ? 'Vérification de la passerelle…'
          : labGatewayStatus ? labGatewayStatus.available
            ? `Passerelle disponible · ${labGatewayStatus.status === 'stopped' ? 'tunnel arrêté' : 'état observé'}`
            : 'Passerelle indisponible'
            : 'État de la passerelle non vérifié'}
      </div>
      ${labError ? `<p class="lab-error" role="alert">${escapeHtml(labError)}</p>` : ''}
      ${labSession ? `<div class="lab-session-details">
        <b>Session de laboratoire · ${escapeHtml(labSession.status)}</b>
        <span>Reçus : ${escapeHtml(labSession.rx_bytes)} octets · envoyés : ${escapeHtml(labSession.tx_bytes)} octets</span>
        <span>Total mesuré : ${escapeHtml(labSession.total_bytes)} octets</span>
        <span>Dernier handshake : ${labSession.last_handshake_at ? formatDate(labSession.last_handshake_at) : 'aucun handshake récent'}</span>
        <button class="secondary" data-action="refresh-lab" ${labLoading ? 'disabled' : ''}>${icon('refresh', 17)} Actualiser l’état réel</button>
        ${['connecting', 'connected', 'interrupted', 'stopping'].includes(labSession.status)
          ? `<button class="secondary session-stop" data-action="stop-lab-session" ${labLoading ? 'disabled' : ''}>${icon('close', 17)} Arrêter le tunnel de test</button>` : ''}
      </div>` : `<label>Appareil associé
        <select data-lab-device ${!activeDevices.length || devicesLoading || labLoading || !controlApiBase ? 'disabled' : ''}>
          ${activeDevices.length ? activeDevices.map((device) => `<option value="${escapeHtml(device.id)}">${escapeHtml(device.device_name)}</option>`).join('') : '<option value="">Aucun appareil actif</option>'}
        </select>
      </label>
      ${labGatewayStatus?.available && ['connected', 'interrupted'].includes(labGatewayStatus.status)
        ? `<p class="lab-error">Un tunnel non suivi par ce processus est actif. Arrête le laboratoire local avant de démarrer une autre session.</p>` : ''}
      <button class="primary full" data-action="start-lab-session" ${!activeDevices.length || devicesLoading || labLoading || !controlApiBase || !labGatewayStatus?.available || ['connected', 'interrupted'].includes(labGatewayStatus.status) ? 'disabled' : ''}>${icon('wifi', 18)} Démarrer une session de test</button>`}
    </section>
    <div class="session-request-card">
      <span class="eyebrow">DEMANDE DE TEST</span>
      <p>Crée une demande de session non autorisée pour vérifier les échanges backend. Elle réserve <b>0 octet</b> et ne démarre aucun VPN.</p>
      <label>Appareil
        <select data-session-device ${!activeDevices.length || devicesLoading || sessionsLoading ? 'disabled' : ''}>
          ${activeDevices.length ? activeDevices.map((device) => `<option value="${escapeHtml(device.id)}">${escapeHtml(device.device_name)}</option>`).join('') : '<option value="">Aucun appareil actif</option>'}
        </select>
      </label>
      <button class="primary full" data-action="request-session" ${!activeDevices.length || devicesLoading || sessionsLoading ? 'disabled' : ''}>${icon('plus', 18)} Demander une session de test</button>
      ${!activeDevices.length ? `<button class="text-button session-devices-link" data-action="devices">Enregistrer un appareil</button>` : ''}
    </div>
    ${sessionLoadError ? backendErrorPanel(sessionLoadError, 'reload-sessions') : ''}
    ${deviceLoadError ? backendErrorPanel(deviceLoadError, 'reload-devices') : ''}
    ${sessionsLoading ? `<div class="backend-loading"><span class="activation-spinner"></span><b>Chargement des sessions…</b></div>` : ''}
    ${!sessionsLoading && !sessionLoadError ? accountSessions.length
      ? `<div class="session-list">${accountSessions.map((session) => {
        const status = verifiedSessionStatus(session)
        const device = accountDevices.find((item) => item.id === session.device_id)
        return `<article class="backend-session-card">
          <button class="session-summary" data-action="session-detail" data-session-id="${escapeHtml(session.id)}">
            <span class="activity-icon ${status === 'stopped' ? '' : 'positive'}">${icon(status === 'failed' ? 'close' : 'wifi', 18)}</span>
            <span class="activity-copy"><b>${escapeHtml(device?.device_name || 'Appareil')}</b><span>${formatDate(session.created_at)}</span><small class="session-status ${status}">${sessionStatusLabel(status)}</small></span>
            ${icon('chevron', 17)}
          </button>
          <div class="session-usage"><span>Réservé <b>${formatBytes(session.reserved_bytes)}</b></span><span>Consommé <b>${formatBytes(session.consumed_bytes)}</b></span><span>Restant <b>${formatBytes(session.remaining_bytes)}</b></span></div>
          ${['requested', 'authorized', 'connecting', 'connected', 'interrupted'].includes(status)
            ? `<button class="secondary session-stop" data-action="stop-session" data-session-id="${escapeHtml(session.id)}">${icon('close', 17)} Demander l’arrêt</button>` : ''}
        </article>`
      }).join('')}</div>`
      : `<div class="empty-state"><span>${icon('clock', 22)}</span><b>Aucune session</b><small>Les demandes de test apparaîtront ici avec leur statut serveur.</small></div>` : ''}
    <div class="help-card"><span class="row-icon">${icon('shield', 20)}</span><div><b>Sessions DataPlus indépendantes</b><p>Le navigateur ne peut pas modifier leur statut. Une session DataPlus connectée exige une réservation et une preuve de passerelle liée à cette session; le laboratoire ci-dessus ne modifie pas ces enregistrements.</p></div></div>
  </section>`
}

const devicePlatformLabel = (platform: DeviceRecord['platform']) =>
  platform === 'web' ? 'Navigateur web'
    : platform === 'android' ? 'Android'
      : platform === 'ios' ? 'iOS' : 'Plateforme inconnue'

const deviceStatusLabel = (status: DeviceRecord['status']) =>
  status === 'active' ? 'Actif' : status === 'inactive' ? 'Inactif' : 'Révoqué'

const verifiedSessionStatus = (session: VpnSessionRecord): VpnSessionRecord['status'] =>
  session.status === 'connected' && !session.gateway_verified_at ? 'failed' : session.status

const sessionStatusLabel = (status: VpnSessionRecord['status']) => ({
  requested: 'Demandée · non autorisée',
  authorized: 'Autorisée · attente client',
  connecting: 'Connexion en cours',
  connected: 'Connectée · vérifiée par la passerelle',
  interrupted: 'Interrompue',
  stopping: 'Arrêt demandé',
  stopped: 'Arrêtée',
  failed: 'Échec ou preuve manquante',
}[status])

const formatBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Ko`
  const gb = bytes / (1024 * 1024 * 1024)
  return gb >= 1
    ? `${gb.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} Go`
    : `${(bytes / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`
}

const settingsScreen = () => `
  <section class="page settings-page">
    ${subpageHeader('Paramètres', 'profile')}
    <div class="settings-group">
      <span class="eyebrow">PRÉFÉRENCES</span>
      <label class="settings-toggle"><span><b>Notifications</b><small>Alertes dans cette application</small></span><input type="checkbox" data-action="toggle-notifications" ${notificationsEnabled ? 'checked' : ''}></label>
      <div class="settings-row"><span><b>Langue</b><small>Français</small></span><span class="settings-value">FR</span></div>
    </div>
    <div class="settings-group">
      <span class="eyebrow">DONNÉES DE DÉMONSTRATION</span>
      <div class="settings-row"><span><b>Stockage</b><small>Local à ce navigateur et à ce compte</small></span>${icon('lock', 18)}</div>
      <button class="settings-row danger-row" data-action="clear-demo-wallet"><span><b>Effacer le portefeuille de démo</b><small>Supprime l’historique local de cet appareil</small></span>${icon('trash', 18)}</button>
    </div>
    <button class="profile-row settings-link" data-action="activation-settings"><span class="row-icon">${icon('wifi', 20)}</span><b>Connexion & activation</b>${icon('chevron', 18)}</button>
    <button class="profile-row settings-link" data-action="devices"><span class="row-icon">${icon('user', 20)}</span><b>Mes appareils</b>${icon('chevron', 18)}</button>
    <button class="profile-row settings-link" data-action="sessions"><span class="row-icon">${icon('clock', 20)}</span><b>Sessions DataPlus</b>${icon('chevron', 18)}</button>
    <button class="profile-row settings-link" data-action="security"><span class="row-icon">${icon('shield', 20)}</span><b>Mot de passe et sécurité</b>${icon('chevron', 18)}</button>
  </section>`

const notificationsScreen = () => `
  <section class="page empty-page">
    ${subpageHeader('Notifications', 'profile')}
    ${demoWallet.notifications.length
      ? `<div class="notification-list">${demoWallet.notifications.map((notification) => `<article class="notification-item ${notification.read ? 'read' : ''}"><span class="activity-icon positive">${icon('bell', 18)}</span><div><b>${escapeHtml(notification.message)}</b><small>${formatDate(notification.createdAt)}</small></div></article>`).join('')}<button class="text-button mark-notifications" data-action="mark-notifications-read">Marquer comme lues</button></div>`
      : `<div class="empty-state activity-empty"><span>${icon('bell', 24)}</span><b>Aucune notification</b><small>Les alertes de consommation et de session apparaîtront ici.</small></div>`}
    <button class="profile-row settings-link" data-action="activation-settings"><span class="row-icon">${icon('settings', 20)}</span><b>Paramètres de connexion</b>${icon('chevron', 18)}</button>
  </section>`

const helpScreen = () => `
  <section class="page help-page">
    ${subpageHeader('Centre d’aide', 'back')}
    <div class="help-card"><span class="row-icon">${icon('wifi', 20)}</span><div><b>À propos du portefeuille</b><p>Cette version permet de tester les écrans et opérations localement. Elle ne réserve pas de données mobiles et ne fournit pas de connexion à distance.</p></div></div>
    <div class="help-card"><span class="row-icon">${icon('lock', 20)}</span><div><b>Où sont stockées les simulations ?</b><p>Dans le stockage local du navigateur, séparément pour chaque compte connecté sur cet appareil.</p></div></div>
    <button class="primary full" data-action="settings">${icon('settings', 19)} Voir les paramètres</button>
  </section>`

const termsScreen = () => `
  <section class="page help-page">
    ${subpageHeader('Conditions', 'profile')}
    <div class="terms-copy"><p>DataPlus est actuellement une démonstration d’interface. Les opérations du portefeuille sont simulées localement.</p><p>Aucun volume de données n’est acheté, transféré ou activé. Cette version ne fournit aucun accès Internet, VPN ou service de connectivité.</p><p>Les données de démonstration restent dans le stockage de ce navigateur et peuvent être supprimées depuis les paramètres.</p></div>
  </section>`

const homeScreen = () => {
  const totals = walletTotals()
  const recent = [...demoWallet.entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 2)
  return `
  <section class="page home-page">
    <header class="topbar">
      <div><p>${currentProfile?.full_name || currentSession?.user.user_metadata.full_name ? 'Bonjour,' : 'Bienvenue sur DataPlus'}</p><h1>${escapeHtml(displayName((currentProfile?.full_name || currentSession?.user.user_metadata.full_name || 'Ravi de te voir').split(' ')[0]))}</h1></div>
      <button class="icon-button notification" data-action="notifications">${icon('bell', 21)}<span></span></button>
    </header>
    <div class="demo-notice">${icon('help', 16)} Portefeuille de démonstration · aucune connexion Internet fournie</div>
    <article class="data-card">
      <div class="card-shine"></div>
      <div class="data-card-head"><div class="card-logo">${icon('wifi', 17)}<span>DATA · DÉMO</span></div><span class="status"><i></i> Local</span></div>
      <div class="data-amount"><strong>${formatData(totals.available)}</strong><span>disponibles en démo</span></div>
      <div class="progress-row"><span>Réservé · consommé</span><b>${formatData(totals.reserved)} · ${formatData(totals.consumed)}</b></div>
      <div class="progress"><span style="width:${totals.reserved ? Math.min(100, Math.round(totals.consumed / totals.reserved * 100)) : 0}%"></span></div>
    </article>
    <div class="quick-actions">
        <button class="primary" data-action="reserve">${icon('plus', 20)} Réserver des données</button>
        <button class="secondary" data-action="activate">${icon('wifi', 20)} Activer</button>
    </div>
    <section class="section-block">
      <div class="section-title"><h2>Activité récente</h2><button data-action="activity">Voir tout</button></div>
      ${recent.length
        ? `<div class="activity-list compact">${recent.map((entry) => activityItem(entry)).join('')}</div>`
        : `<div class="empty-state compact-empty"><span>${icon('activity', 22)}</span><b>Aucune activité pour l’instant</b><small>Les réservations de démonstration apparaîtront ici.</small></div>`}
    </section>
    <button class="info-strip" data-action="help">
      <span class="info-icon">${icon('help', 20)}</span>
      <span><b>Comment ça fonctionne ?</b><small>Prépare. Emporte. Profite.</small></span>
      ${icon('chevron', 18)}
    </button>
  </section>`
}

const walletScreen = () => {
  const totals = walletTotals()
  const recent = [...demoWallet.entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3)
  const usedPercent = totals.reserved ? Math.min(100, Math.round(totals.consumed / totals.reserved * 100)) : 0
  return `
  <section class="page wallet-page">
    <header class="page-header"><h1>Mon portefeuille</h1><button class="icon-button" data-action="refresh" aria-label="Actualiser le portefeuille">${icon('refresh', 20)}</button></header>
    <div class="demo-notice">${icon('help', 16)} Démonstration locale · données non réelles</div>
    <article class="wallet-hero">
      <span class="eyebrow">SOLDE DISPONIBLE</span>
      <div class="wallet-total"><strong>${formatData(totals.available)}</strong></div>
      <div class="wallet-ring" style="background:conic-gradient(#62bbb7 0 ${usedPercent}%,#cad8d5 ${usedPercent}% 100%)"><span>${usedPercent}%</span></div>
      <div class="wallet-stats">
        <div><i class="dot teal"></i><span>Total réservé</span><b>${formatData(totals.reserved)}</b></div>
        <div><i class="dot pale"></i><span>Consommé</span><b>${formatData(totals.consumed)}</b></div>
      </div>
    </article>
    <button class="primary full" data-action="reserve">${icon('plus', 20)} Nouvelle réservation</button>
    <section class="section-block">
      <div class="section-title"><h2>Dernières opérations</h2><button data-action="activity">Historique complet</button></div>
      ${recent.length
        ? `<div class="wallet-entries">${recent.map((entry) => walletEntryCard(entry)).join('')}</div>`
        : `<div class="empty-state"><span>${icon('wallet', 22)}</span><b>Ton portefeuille est vide</b><small>Les réservations de démonstration seront visibles ici.</small></div>`}
    </section>
  </section>`
}

const entryIcon = (entry: WalletEntry) =>
  entry.kind === 'reservation' ? 'plus'
    : entry.kind === 'activation' ? 'check'
      : entry.kind === 'consumption' ? 'activity' : 'close'

const entryStatusLabel = (entry: WalletEntry) =>
  entry.kind === 'activation'
    ? entry.status === 'completed' ? 'Crédit épuisé · simulation'
      : entry.status === 'pending' ? 'En attente du réseau réel'
        : entry.status === 'cancelled' ? 'Désactivée · simulation' : 'Interrompue · simulation'
    : entry.status === 'completed' ? 'Enregistrée en démo'
      : entry.status === 'pending' ? 'En attente'
        : entry.status === 'cancelled' ? 'Annulée' : 'Échec'

const walletEntryCard = (entry: WalletEntry) => `
  <button class="wallet-entry" data-action="entry-detail" data-entry-id="${escapeHtml(entry.id)}">
    <span class="activity-icon ${entry.status === 'completed' ? 'positive' : ''}">${icon(entryIcon(entry), 19)}</span>
    <span class="activity-copy"><b>${escapeHtml(entry.title)}</b><span>${formatDate(entry.createdAt)} · ${entryStatusLabel(entry)}</span></span>
    <strong class="${entry.status === 'completed' && entry.kind === 'reservation' ? 'positive' : ''}">${entry.kind === 'activation'
      ? `${formatData(entry.sessionId ? sessionConsumption(entry.sessionId) : 0)} utilisés`
      : `${entry.kind === 'consumption' || entry.kind === 'cancellation' ? '−' : '+'}${formatData(entry.amountMb)}`}</strong>
  </button>`

const activityItem = (entry: WalletEntry) => walletEntryCard(entry)

const activityScreen = () => {
  const entries = [...demoWallet.entries]
    .filter((entry) => activityFilter === 'all' || entry.kind === activityFilter)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return `
  <section class="page activity-page">
    <header class="page-header"><h1>Activité</h1><button class="icon-button" data-action="refresh" aria-label="Actualiser">${icon('refresh', 20)}</button></header>
    <div class="demo-notice">${icon('help', 16)} Historique des opérations de démonstration</div>
    <div class="filter-row">
      ${[['all', 'Tout'], ['reservation', 'Réservations'], ['activation', 'Activations'], ['consumption', 'Consommations'], ['cancellation', 'Annulations']]
        .map(([value, label]) => `<button class="${activityFilter === value ? 'active' : ''}" data-filter="${value}">${label}</button>`).join('')}
    </div>
    ${entries.length
      ? `<p class="date-label">Opérations récentes</p><div class="wallet-entries">${entries.map((entry) => activityItem(entry)).join('')}</div>`
      : `<div class="empty-state activity-empty"><span>${icon('activity', 24)}</span><b>${demoWallet.entries.length ? 'Aucune opération dans ce filtre' : 'Aucune activité pour l’instant'}</b><small>${demoWallet.entries.length ? 'Choisis une autre catégorie pour voir tes opérations.' : 'Tes réservations simulées apparaîtront ici.'}</small></div>`}
  </section>`
}

const profileScreen = () => `
  <section class="page profile-page">
    <header class="page-header"><h1>Profil</h1><button class="icon-button" data-action="settings">${icon('settings', 20)}</button></header>
    <article class="profile-card">
      ${currentProfile?.avatar_url
        ? `<img class="avatar-photo" src="${escapeHtml(currentProfile.avatar_url)}" alt="Photo de profil"><span class="avatar-status"></span>`
        : `<div class="avatar">${initials(currentProfile?.full_name || currentSession?.user.email || 'Utilisateur')}<span></span></div>`}
      <div><h2>${escapeHtml(displayName(currentProfile?.full_name || currentSession?.user.user_metadata.full_name || 'Utilisateur'))}</h2><p>${escapeHtml(currentSession?.user.email || '')}</p></div>
      <button class="icon-button" data-action="edit">${icon('chevron', 18)}</button>
    </article>
    <div class="profile-section">
      <p>Compte</p>
      ${profileRow('user', 'Informations personnelles', 'edit')}
      ${profileRow('user', 'Mes appareils', 'devices')}
      ${profileRow('clock', 'Sessions DataPlus', 'sessions')}
      ${profileRow('shield', 'Sécurité', 'security')}
      ${profileRow('bell', 'Notifications', 'notifications')}
    </div>
    <div class="profile-section">
      <p>Assistance</p>
      ${profileRow('help', 'Centre d’aide', 'help')}
      ${profileRow('settings', 'Paramètres généraux', 'settings')}
      ${profileRow('credit', 'Conditions d’utilisation', 'terms')}
    </div>
    <button class="logout" data-action="logout">${icon('logout', 20)} Se déconnecter</button>
  </section>`

const profileRow = (iconName: string, label: string, action: string) =>
  `<button class="profile-row" data-action="${action}"><span class="row-icon">${icon(iconName, 20)}</span><b>${label}</b>${icon('chevron', 18)}</button>`

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]!)

const initials = (value: string) =>
  value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'U'

const displayName = (value: string) =>
  value.trim().split(/\s+/).map((part) => part ? `${part[0].toLocaleUpperCase('fr-FR')}${part.slice(1)}` : '').join(' ')

const renderCurrentScreen = () => {
  const screen = document.querySelector('#screen')
  if (!screen) return
  screen.innerHTML = renderScreen()
  bindAppActions()
}

const navigate = (screen: Screen) => {
  activeScreen = screen
  renderCurrentScreen()
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', (item as HTMLElement).dataset.screen === screen)
  })
  if (screen === 'devices') void loadAccountDevices()
  if (screen === 'sessions') {
    void loadAccountDevices()
    void loadAccountSessions()
  void loadLabGatewayStatus()
  }
}

const bindAppActions = () => {
  document.querySelectorAll('#screen [data-action]').forEach((el) => el.addEventListener('click', () => {
    const target = el as HTMLElement
    const action = target.dataset.action
    if (action === 'home' || action === 'wallet' || action === 'activity' || action === 'profile') { navigate(action); return }
    if (action === 'activate') { navigate('activate'); return }
    if (action === 'activation-settings') { navigate('activation-settings'); return }
    if (action === 'devices') { navigate('devices'); return }
    if (action === 'sessions') { navigate('sessions'); return }
    if (action === 'reload-devices') { void loadAccountDevices(); return }
    if (action === 'reload-sessions') { void loadAccountDevices(); void loadAccountSessions(); void loadLabGatewayStatus(); return }
    if (action === 'register-device') { openDeviceRegistration(); return }
    if (action === 'revoke-device') { confirmDeviceRevocation(target.dataset.deviceId || ''); return }
    if (action === 'request-session') { void requestControlSession(); return }
    if (action === 'start-lab-session') { void startLabSession(); return }
    if (action === 'refresh-lab') { void refreshLabSession(); return }
    if (action === 'stop-lab-session') { confirmLabSessionStop(); return }
    if (action === 'stop-session') { confirmSessionStop(target.dataset.sessionId || ''); return }
    if (action === 'session-detail') { showControlSessionDetail(target.dataset.sessionId || ''); return }
    if (action === 'back') { navigate('home'); return }
    if (action === 'reserve') { selectedVolumeMb = 500; navigate('reserve'); return }
    if (action === 'back-reserve') { navigate('reserve'); return }
    if (action === 'review-reservation') { navigate('reserve-confirm'); return }
    if (action === 'select-volume') {
      const amount = Number(target.dataset.volumeMb)
      if (volumeOptions.some((option) => option.mb === amount)) {
        selectedVolumeMb = amount
        renderCurrentScreen()
      }
      return
    }
    if (action === 'confirm-reservation') { confirmDemoReservation(); return }
    if (action === 'refresh') { refreshDemoWallet(); return }
    if (action === 'entry-detail') { showEntryDetail(target.dataset.entryId || ''); return }
    if (action === 'use') {
      navigate('activate')
      return
    }
    if (action === 'activity') { navigate('activity'); return }
    if (action === 'settings') { navigate('settings'); return }
    if (action === 'notifications') { navigate('notifications'); return }
    if (action === 'help') { navigate('help'); return }
    if (action === 'terms') { navigate('terms'); return }
    if (action === 'security') { passwordReset(true); return }
    if (action === 'edit') { editProfile(); return }
    if (action === 'logout') { void logout(); return }
    if (action === 'toggle-notifications') {
      notificationsEnabled = (target as HTMLInputElement).checked
      localStorage.setItem('dataplus_notifications', String(notificationsEnabled))
      showToast(notificationsEnabled ? 'Notifications activées.' : 'Notifications désactivées.')
      return
    }
    if (action === 'clear-demo-wallet') {
      const modal = openModal('Effacer les données de démo ?', 'Cette action supprimera le portefeuille et son historique local sur cet appareil.', 'Effacer')
      modal.querySelector('.modal-action')?.addEventListener('click', () => {
        if (!currentSession) return
        localStorage.removeItem(walletStorageKey(currentSession.user.id))
        demoWallet = { entries: [], activationSession: null, notifications: [] }
        navigate('wallet')
        showToast('Portefeuille de démonstration effacé.')
      })
    }
    if (action === 'activation-submit') {
      if (activationConfirmationEnabled) {
        const modal = openModal(
          'Préparer une activation ?',
          'Cette action crée uniquement une session de démonstration locale. Elle n’établit aucune connexion Internet.',
          'Préparer la simulation',
        )
        modal.querySelector('.modal-action')?.addEventListener('click', () => {
          window.setTimeout(() => { void startDemoActivation() }, 230)
        })
      } else {
        void startDemoActivation()
      }
      return
    }
    if (action === 'simulate-consumption') { simulateDemoConsumption(); return }
    if (action === 'deactivate') { finishDemoActivation('cancelled'); return }
    if (action === 'simulate-interruption') { finishDemoActivation('failed'); return }
    if (action === 'toggle-activation-notifications') {
      activationNotificationsEnabled = (target as HTMLInputElement).checked
      localStorage.setItem('dataplus_activation_notifications', String(activationNotificationsEnabled))
      showToast(activationNotificationsEnabled ? 'Alertes de consommation activées.' : 'Alertes de consommation désactivées.')
      return
    }
    if (action === 'toggle-activation-confirmation') {
      activationConfirmationEnabled = (target as HTMLInputElement).checked
      localStorage.setItem('dataplus_activation_confirmation', String(activationConfirmationEnabled))
      showToast(activationConfirmationEnabled ? 'La confirmation manuelle est activée.' : 'La confirmation manuelle est désactivée.')
      return
    }
    if (action === 'mark-notifications-read') {
      try {
        saveDemoWallet({ ...demoWallet, notifications: demoWallet.notifications.map((notification) => ({ ...notification, read: true })) })
        renderCurrentScreen()
      } catch (error) {
        console.error('Could not mark demo notifications as read:', error)
        showToast('Impossible de mettre à jour les notifications.', 'error')
      }
    }
  }))
  document.querySelectorAll('#screen [data-filter]').forEach((el) => el.addEventListener('click', () => {
    activityFilter = (el as HTMLElement).dataset.filter || 'all'
    renderCurrentScreen()
  }))
  document.querySelectorAll<HTMLSelectElement>('#screen [data-activation-filter]').forEach((el) => el.addEventListener('change', () => {
    if (el.dataset.activationFilter === 'period') activationHistoryPeriod = el.value
    if (el.dataset.activationFilter === 'status') activationHistoryStatus = el.value
    renderCurrentScreen()
  }))
}

const startDemoActivation = async () => {
  navigate('activate')
  if (demoWallet.activationSession) {
    showToast('Une session de démonstration est déjà en attente du réseau réel.', 'error')
    return
  }
  if (walletTotals().available <= 0) {
    openModal(
      'Aucune donnée disponible',
      'Ajoute d’abord un volume de démonstration depuis ton portefeuille. Aucun crédit réel ne sera créé.',
      'Compris',
    )
    return
  }
  activationPhase = 'checking'
  renderCurrentScreen()
  await wait(550)
  if (walletTotals().available <= 0 || !currentSession) {
    activationPhase = 'idle'
    renderCurrentScreen()
    showToast('Activation impossible : aucun crédit de démonstration disponible.', 'error')
    return
  }
  activationPhase = 'preparing'
  renderCurrentScreen()
  await wait(550)
  const startedAt = new Date().toISOString()
  const sessionId = crypto.randomUUID()
  const activationEntry: WalletEntry = {
    id: crypto.randomUUID(),
    sessionId,
    kind: 'activation',
    amountMb: walletTotals().available,
    status: 'pending',
    createdAt: startedAt,
    title: 'Activation simulée · en attente du réseau réel',
  }
  try {
    saveDemoWallet({
      ...demoWallet,
      entries: [activationEntry, ...demoWallet.entries],
      activationSession: { id: sessionId, startedAt, initialMb: activationEntry.amountMb, entryId: activationEntry.id },
    })
    activationPhase = 'idle'
    addDemoNotification('Activation simulée préparée, en attente du réseau réel.')
    navigate('activate')
  } catch (error) {
    activationPhase = 'idle'
    console.error('Could not start demo activation:', error)
    renderCurrentScreen()
    showToast('Impossible d’enregistrer la session de démonstration.', 'error')
  }
}

const finishDemoActivation = (status: 'cancelled' | 'failed' | 'completed') => {
  const session = demoWallet.activationSession
  if (!session) {
    showToast('Aucune session de démonstration n’est active.', 'error')
    return
  }
  const endedAt = new Date().toISOString()
  const title = status === 'failed'
    ? 'Activation simulée interrompue'
    : status === 'completed'
      ? 'Crédit épuisé · simulation terminée'
      : 'Activation simulée désactivée'
  try {
    saveDemoWallet({
      ...demoWallet,
      activationSession: null,
      entries: demoWallet.entries.map((entry) => entry.id === session.entryId
        ? { ...entry, status, endedAt, title }
        : entry),
    })
    const message = status === 'failed'
      ? 'Simulation interrompue. Aucun accès Internet réel n’a été actif.'
      : status === 'completed'
        ? 'Crédit de démonstration épuisé. La simulation est terminée.'
        : 'Simulation désactivée. Aucun accès Internet réel n’a été actif.'
    addDemoNotification(message)
    renderCurrentScreen()
  } catch (error) {
    console.error('Could not finish demo activation:', error)
    showToast('Impossible de mettre à jour cette session de démonstration.', 'error')
  }
}

const simulateDemoConsumption = () => {
  const session = demoWallet.activationSession
  if (!session) {
    showToast('Aucune session de démonstration n’est active.', 'error')
    return
  }
  const before = sessionConsumption(session.id)
  const remaining = Math.max(0, session.initialMb - before)
  if (!remaining) {
    finishDemoActivation('completed')
    return
  }
  const amountMb = Math.min(100, remaining)
  const consumption: WalletEntry = {
    id: crypto.randomUUID(),
    sessionId: session.id,
    kind: 'consumption',
    amountMb,
    status: 'completed',
    createdAt: new Date().toISOString(),
    title: `${formatData(amountMb)} consommés · simulation`,
  }
  const after = before + amountMb
  try {
    saveDemoWallet({ ...demoWallet, entries: [consumption, ...demoWallet.entries] })
    for (const threshold of [50, 80, 100]) {
      if (before / session.initialMb < threshold / 100 && after / session.initialMb >= threshold / 100) {
        addDemoNotification(threshold === 100
          ? '100 % du crédit de démonstration a été simulé comme consommé.'
          : `${threshold} % du crédit de démonstration a été simulé comme consommé.`)
      }
    }
    if (after >= session.initialMb) finishDemoActivation('completed')
    else renderCurrentScreen()
  } catch (error) {
    console.error('Could not simulate data consumption:', error)
    showToast('Impossible d’enregistrer cette consommation simulée.', 'error')
  }
}

const confirmDemoReservation = () => {
  const entry: WalletEntry = {
    id: crypto.randomUUID(),
    kind: 'reservation',
    amountMb: selectedVolumeMb,
    status: 'completed',
    createdAt: new Date().toISOString(),
    title: `Ajout de ${formatData(selectedVolumeMb)} · simulation`,
  }
  try {
    saveDemoWallet({ entries: [entry, ...demoWallet.entries] })
    navigate('wallet')
    showToast(`${formatData(selectedVolumeMb)} ajouté au portefeuille de démonstration.`)
  } catch (error) {
    console.error('Could not save demo reservation:', error)
    showToast('Impossible d’enregistrer la simulation dans ce navigateur.', 'error')
  }
}

const refreshDemoWallet = () => {
  const restored = restoreDemoWallet()
  renderCurrentScreen()
  if (restored) showToast('Portefeuille de démonstration actualisé.')
}

const loadAccountDevices = async () => {
  if (!currentSession) return
  const userId = currentSession.user.id
  const generation = ++deviceLoadGeneration
  devicesLoading = true
  deviceLoadError = ''
  if (activeScreen === 'devices' || activeScreen === 'sessions') renderCurrentScreen()
  try {
    const data = controlApiBase
      ? await requestControlApi<DeviceRecord[]>('/devices')
      : await (async () => {
        const { data, error } = await supabase
          .from('devices')
          .select('id,device_name,platform,status,created_at,last_seen_at,revoked_at')
          .order('created_at', { ascending: false })
        if (error) throw error
        return data || []
      })()
    if (currentSession?.user.id !== userId || generation !== deviceLoadGeneration) return
    accountDevices = data as DeviceRecord[]
  } catch (error) {
    console.error('Could not load account devices:', error)
    if (currentSession?.user.id !== userId || generation !== deviceLoadGeneration) return
    deviceLoadError = getErrorMessage(error, 'Impossible de charger les appareils.')
    accountDevices = []
  } finally {
    if (currentSession?.user.id === userId && generation === deviceLoadGeneration) {
      devicesLoading = false
      if (activeScreen === 'devices' || activeScreen === 'sessions') renderCurrentScreen()
    }
  }
}

const loadAccountSessions = async () => {
  if (!currentSession) return
  const userId = currentSession.user.id
  const generation = ++sessionLoadGeneration
  sessionsLoading = true
  sessionLoadError = ''
  if (activeScreen === 'sessions') renderCurrentScreen()
  try {
    const data = controlApiBase
      ? await requestControlApi<VpnSessionRecord[]>('/sessions')
      : await (async () => {
        const { data, error } = await supabase
          .from('vpn_sessions')
          .select('id,device_id,status,reserved_bytes,consumed_bytes,remaining_bytes,created_at,started_at,stopped_at,gateway_verified_at')
          .order('created_at', { ascending: false })
          .limit(50)
        if (error) throw error
        return data || []
      })()
    if (currentSession?.user.id !== userId || generation !== sessionLoadGeneration) return
    accountSessions = data as VpnSessionRecord[]
  } catch (error) {
    console.error('Could not load account VPN sessions:', error)
    if (currentSession?.user.id !== userId || generation !== sessionLoadGeneration) return
    sessionLoadError = getErrorMessage(error, 'Impossible de charger les sessions.')
    accountSessions = []
  } finally {
    if (currentSession?.user.id === userId && generation === sessionLoadGeneration) {
      sessionsLoading = false
      if (activeScreen === 'sessions') renderCurrentScreen()
    }
  }
}

const loadLabGatewayStatus = async () => {
  if (!controlApiBase || !currentSession) {
    labError = 'Le backend de laboratoire n’est pas configuré.'
    labGatewayStatus = null
    labSession = null
    if (activeScreen === 'sessions') renderCurrentScreen()
    return
  }
  const userId = currentSession.user.id
  labLoading = true
  labError = ''
  if (activeScreen === 'sessions') renderCurrentScreen()
  try {
    const [gateway, session] = await Promise.all([
      requestControlApi<LabGatewayStatus>('/lab/gateway'),
      requestControlApi<LabSessionRecord | null>('/lab/sessions/current'),
    ])
    if (currentSession?.user.id !== userId) return
    labGatewayStatus = gateway
    labSession = session
  } catch (error) {
    console.error('Could not inspect local VPN lab:', error)
    if (currentSession?.user.id !== userId) return
    labError = backendErrorMessage(getErrorMessage(error, 'Impossible de vérifier le laboratoire VPN.'))
    labGatewayStatus = null
    labSession = null
  } finally {
    if (currentSession?.user.id === userId) {
      labLoading = false
      if (activeScreen === 'sessions') renderCurrentScreen()
    }
  }
}

const refreshLabSession = async () => {
  if (!controlApiBase || !currentSession) return
  labLoading = true
  labError = ''
  renderCurrentScreen()
  try {
    const [gateway, session] = await Promise.all([
      requestControlApi<LabGatewayStatus>('/lab/gateway'),
      requestControlApi<LabSessionRecord | null>('/lab/sessions/current'),
    ])
    labGatewayStatus = gateway
    labSession = session
  } catch (error) {
    console.error('Could not refresh local VPN lab:', error)
    labError = backendErrorMessage(getErrorMessage(error, 'Impossible d’actualiser le laboratoire VPN.'))
  } finally {
    labLoading = false
    if (activeScreen === 'sessions') renderCurrentScreen()
  }
}

const startLabSession = async () => {
  const deviceId = document.querySelector<HTMLSelectElement>('[data-lab-device]')?.value
  if (!deviceId || !accountDevices.some((device) => device.id === deviceId && device.status === 'active')) {
    showToast('Enregistre un appareil actif avant de démarrer le laboratoire.', 'error')
    return
  }
  if (!controlApiBase) {
    showToast('Le backend de laboratoire n’est pas configuré.', 'error')
    return
  }
  labLoading = true
  labError = ''
  renderCurrentScreen()
  try {
    labSession = await requestControlApi<LabSessionRecord>('/lab/sessions', {
      method: 'POST',
      body: JSON.stringify({ device_id: deviceId, idempotency_key: crypto.randomUUID() }),
    })
    labGatewayStatus = await requestControlApi<LabGatewayStatus>('/lab/gateway')
    showToast('Handshake WireGuard de laboratoire confirmé. Aucun accès Internet ni débit portefeuille.')
  } catch (error) {
    console.error('Could not start local VPN lab session:', error)
    labError = backendErrorMessage(getErrorMessage(error, 'Impossible de démarrer le laboratoire VPN.'))
    showToast(labError, 'error')
  } finally {
    labLoading = false
    if (activeScreen === 'sessions') renderCurrentScreen()
  }
}

const confirmLabSessionStop = () => {
  if (!labSession || !controlApiBase) return
  const sessionId = labSession.id
  const modal = openModal(
    'Arrêter le tunnel de test ?',
    'Le backend attendra la confirmation que l’interface WireGuard locale est arrêtée.',
    'Arrêter le tunnel',
  )
  modal.querySelector('.modal-action')?.addEventListener('click', () => {
    window.setTimeout(async () => {
      labLoading = true
      renderCurrentScreen()
      try {
        labSession = await requestControlApi<LabSessionRecord>(
          `/lab/sessions/${encodeURIComponent(sessionId)}/stop`,
          { method: 'POST', body: JSON.stringify({}) },
        )
        labGatewayStatus = await requestControlApi<LabGatewayStatus>('/lab/gateway')
        showToast('Arrêt du tunnel WireGuard local confirmé.')
      } catch (error) {
        console.error('Could not stop local VPN lab session:', error)
        labError = backendErrorMessage(getErrorMessage(error, 'Impossible de confirmer l’arrêt du tunnel.'))
        showToast(labError, 'error')
      } finally {
        labLoading = false
        if (activeScreen === 'sessions') renderCurrentScreen()
      }
    }, 230)
  })
}

const openDeviceRegistration = () => {
  const modal = document.createElement('div')
  modal.className = 'modal-backdrop'
  modal.innerHTML = `
    <div class="modal-sheet device-register-sheet">
      <button class="modal-close" aria-label="Fermer">×</button>
      <span class="eyebrow">REGISTRE DU COMPTE</span>
      <h2>Enregistrer cet appareil</h2>
      <p>Cette inscription associe un nom à ton compte DataPlus. Elle ne configure pas encore de tunnel VPN.</p>
      <form id="device-register-form">
        <label>Nom de l’appareil<div class="field">${icon('user', 19)}<input id="device-register-name" maxlength="60" minlength="2" required value="Mon navigateur web" autocomplete="off"></div></label>
        <p class="form-error" id="device-register-error" role="alert"></p>
        <button class="primary full" type="submit">${icon('check', 18)} Enregistrer</button>
      </form>
    </div>`
  overlayHost().appendChild(modal)
  requestAnimationFrame(() => modal.classList.add('open'))
  const close = () => {
    modal.classList.remove('open')
    window.setTimeout(() => modal.remove(), 220)
  }
  modal.querySelector('.modal-close')?.addEventListener('click', close)
  modal.addEventListener('click', (event) => { if (event.target === modal) close() })
  const registrationKey = crypto.randomUUID()
  modal.querySelector<HTMLFormElement>('#device-register-form')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const nameInput = modal.querySelector<HTMLInputElement>('#device-register-name')!
    const errorEl = modal.querySelector<HTMLElement>('#device-register-error')!
    const name = nameInput.value.trim()
    if (name.length < 2 || name.length > 60) {
      errorEl.textContent = 'Le nom doit contenir entre 2 et 60 caractères.'
      return
    }
    const submit = modal.querySelector<HTMLButtonElement>('button[type="submit"]')!
    submit.disabled = true
    submit.textContent = 'Enregistrement…'
    try {
      if (controlApiBase) {
        await requestControlApi<DeviceRecord>('/devices', {
          method: 'POST',
          body: JSON.stringify({
            device_name: name,
            platform: 'web',
            idempotency_key: registrationKey,
          }),
        })
      } else {
        const { error } = await supabase.rpc('register_dataplus_device', {
          p_device_name: name,
          p_platform: 'web',
          p_registration_key: registrationKey,
        })
        if (error) throw error
      }
      close()
      await loadAccountDevices()
      showToast('Appareil ajouté au registre de ton compte. Aucun VPN n’a été configuré.')
    } catch (error) {
      console.error('Could not register account device:', error)
      errorEl.textContent = backendErrorMessage(getErrorMessage(error, 'Impossible d’enregistrer cet appareil.'))
      submit.disabled = false
      submit.innerHTML = `${icon('check', 18)} Enregistrer`
    }
  })
}

const confirmDeviceRevocation = (deviceId: string) => {
  const device = accountDevices.find((item) => item.id === deviceId)
  if (!device) {
    showToast('Cet appareil est introuvable dans ton compte.', 'error')
    return
  }
  const modal = openModal(
    'Révoquer cet appareil ?',
    `« ${device.device_name} » ne pourra plus demander de session DataPlus.`,
    'Révoquer',
  )
  modal.querySelector('.modal-action')?.addEventListener('click', () => {
    window.setTimeout(async () => {
      try {
        if (controlApiBase) {
          await requestControlApi<DeviceRecord>(`/devices/${encodeURIComponent(deviceId)}/revoke`, {
            method: 'POST',
            body: JSON.stringify({}),
          })
        } else {
          const { error } = await supabase.rpc('revoke_dataplus_device', { p_device_id: deviceId })
          if (error) throw error
        }
        await loadAccountDevices()
        showToast('Appareil révoqué.')
      } catch (error) {
        console.error('Could not revoke account device:', error)
        showToast(backendErrorMessage(getErrorMessage(error, 'Impossible de révoquer cet appareil.')), 'error')
      }
    }, 230)
  })
}

const requestControlSession = async () => {
  const deviceSelect = document.querySelector<HTMLSelectElement>('[data-session-device]')
  const deviceId = deviceSelect?.value
  if (!deviceId || !accountDevices.some((device) => device.id === deviceId && device.status === 'active')) {
    navigate('devices')
    showToast('Enregistre un appareil actif avant de demander une session.', 'error')
    return
  }
  const button = document.querySelector<HTMLButtonElement>('[data-action="request-session"]')
  if (button) { button.disabled = true; button.textContent = 'Envoi de la demande…' }
  if (pendingSessionRequest?.deviceId !== deviceId) {
    pendingSessionRequest = { deviceId, idempotencyKey: crypto.randomUUID() }
  }
  try {
    if (controlApiBase) {
      await requestControlApi<VpnSessionRecord>('/sessions', {
        method: 'POST',
        body: JSON.stringify({
          device_id: deviceId,
          idempotency_key: pendingSessionRequest.idempotencyKey,
        }),
      })
    } else {
      const { error } = await supabase.rpc('request_dataplus_session', {
        p_device_id: deviceId,
        p_idempotency_key: pendingSessionRequest.idempotencyKey,
      })
      if (error) throw error
    }
    pendingSessionRequest = null
    await loadAccountSessions()
    showToast('Demande enregistrée. Elle n’est pas autorisée et aucun tunnel n’a été démarré.')
  } catch (error) {
    console.error('Could not request account session:', error)
    if (button) { button.disabled = false; button.innerHTML = `${icon('plus', 18)} Demander une session de test` }
    showToast(backendErrorMessage(getErrorMessage(error, 'Impossible de créer la demande.')), 'error')
  }
}

const confirmSessionStop = (sessionId: string) => {
  const session = accountSessions.find((item) => item.id === sessionId)
  if (!session) {
    showToast('Cette session est introuvable dans ton compte.', 'error')
    return
  }
  const modal = openModal(
    'Demander l’arrêt ?',
    'La demande sera transmise au backend. Une session réseau réelle ne sera marquée arrêtée qu’après confirmation de la passerelle.',
    'Confirmer l’arrêt',
  )
  modal.querySelector('.modal-action')?.addEventListener('click', () => {
    window.setTimeout(async () => {
      try {
        if (controlApiBase) {
          await requestControlApi<VpnSessionRecord>(`/sessions/${encodeURIComponent(sessionId)}/stop`, {
            method: 'POST',
            body: JSON.stringify({}),
          })
        } else {
          const { error } = await supabase.rpc('request_dataplus_session_stop', { p_session_id: sessionId })
          if (error) throw error
        }
        await loadAccountSessions()
        showToast('Demande d’arrêt enregistrée.')
      } catch (error) {
        console.error('Could not request VPN session stop:', error)
        showToast(backendErrorMessage(getErrorMessage(error, 'Impossible de demander l’arrêt.')), 'error')
      }
    }, 230)
  })
}

const showControlSessionDetail = (sessionId: string) => {
  const session = accountSessions.find((item) => item.id === sessionId)
  if (!session) {
    showToast('Cette session est introuvable dans ton compte.', 'error')
    return
  }
  const status = verifiedSessionStatus(session)
  openModal(
    'Détails de la session',
    `État : ${sessionStatusLabel(status)}\nCréée : ${formatDate(session.created_at)}\nRéservé : ${formatBytes(session.reserved_bytes)}\nConsommé : ${formatBytes(session.consumed_bytes)}\nRestant : ${formatBytes(session.remaining_bytes)}${session.started_at ? `\nDémarrée : ${formatDate(session.started_at)}` : ''}${session.stopped_at ? `\nArrêtée : ${formatDate(session.stopped_at)}` : ''}\n\n${session.gateway_verified_at ? 'La passerelle a enregistré une vérification.' : 'Aucune preuve de connexion réseau enregistrée.'}`,
    'Fermer',
  )
}

const showEntryDetail = (id: string) => {
  const entry = demoWallet.entries.find((item) => item.id === id)
  if (!entry) {
    showToast('Cette opération est introuvable.', 'error')
    return
  }
  const sessionDetails = entry.kind === 'activation'
    ? `\nVolume initial : ${formatData(entry.amountMb)}\nConsommé en simulation : ${formatData(entry.sessionId ? sessionConsumption(entry.sessionId) : 0)}\nDurée : ${durationLabel(entry.createdAt, entry.endedAt)}`
    : `\nVolume : ${formatData(entry.amountMb)}`
  openModal(
    entry.title,
    `${entryStatusLabel(entry)}\n${formatDate(entry.createdAt)}${sessionDetails}\n\nCette session est une simulation locale. Aucune connexion Internet réelle n’a été établie.`,
    'Fermer',
  )
}

const editProfile = () => {
  if (!currentSession) return
  const session = currentSession
  let removeAvatar = false
  let previewUrl: string | null = null
  const modal = document.createElement('div')
  modal.className = 'modal-backdrop'
  modal.innerHTML = `
    <div class="modal-sheet profile-edit-sheet">
      <button class="modal-close" aria-label="Fermer">×</button>
      <h2>Informations personnelles</h2>
      <form id="profile-form">
        <label>Nom complet<div class="field">${icon('user', 19)}<input id="profile-name" value="${escapeHtml(currentProfile?.full_name || session.user.user_metadata.full_name || '')}" autocomplete="name"></div></label>
        <div class="avatar-editor">
          ${currentProfile?.avatar_url
            ? `<img id="avatar-preview" class="avatar-photo" src="${escapeHtml(currentProfile.avatar_url)}" alt="Aperçu de la photo">`
            : `<div id="avatar-fallback" class="avatar">${initials(currentProfile?.full_name || session.user.email || 'Utilisateur')}</div>`}
          <div class="avatar-editor-actions">
            <label class="photo-pick">${icon('camera', 17)} Choisir une photo
              <input id="profile-avatar" class="file-input-hidden" type="file" accept="image/png,image/jpeg,image/webp" capture="user">
            </label>
            ${currentProfile?.avatar_url ? `<button type="button" class="remove-photo" data-action="remove-avatar">${icon('trash', 16)} Supprimer</button>` : ''}
          </div>
        </div>
        <small class="photo-hint">JPG, PNG ou WebP · 5 Mo maximum. La caméra dépend de ton appareil et de ton navigateur.</small>
        <p class="form-error" id="profile-error" role="alert"></p>
        <button class="primary full" type="submit"><span>Enregistrer</span>${icon('check', 19)}</button>
      </form>
    </div>`
  overlayHost().appendChild(modal)
  requestAnimationFrame(() => modal.classList.add('open'))
  const close = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    modal.classList.remove('open')
    setTimeout(() => modal.remove(), 220)
  }
  modal.querySelector('.modal-close')?.addEventListener('click', close)
  modal.querySelector<HTMLInputElement>('#profile-avatar')?.addEventListener('change', (event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0]
    if (!file) return
    const preview = modal.querySelector<HTMLImageElement>('#avatar-preview')
    const fallback = modal.querySelector<HTMLElement>('#avatar-fallback')
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    previewUrl = URL.createObjectURL(file)
    if (preview) preview.src = previewUrl
    else if (fallback) {
      const image = document.createElement('img')
      image.id = 'avatar-preview'
      image.className = 'avatar-photo'
      image.alt = 'Aperçu de la photo'
      image.src = previewUrl
      fallback.replaceWith(image)
    }
    removeAvatar = false
  })
  modal.querySelector('[data-action="remove-avatar"]')?.addEventListener('click', () => {
    removeAvatar = true
    const preview = modal.querySelector('#avatar-preview')
    if (preview) {
      const fallback = document.createElement('div')
      fallback.id = 'avatar-fallback'
      fallback.className = 'avatar'
      fallback.textContent = initials(currentProfile?.full_name || session.user.email || 'Utilisateur')
      preview.replaceWith(fallback)
    }
    modal.querySelector('[data-action="remove-avatar"]')?.remove()
    const picker = modal.querySelector<HTMLInputElement>('#profile-avatar')
    if (picker) picker.value = ''
  })
  modal.querySelector('#profile-form')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const name = (modal.querySelector('#profile-name') as HTMLInputElement).value.trim()
    const file = (modal.querySelector('#profile-avatar') as HTMLInputElement).files?.[0]
    const errorEl = modal.querySelector('#profile-error')!
    if (name.length < 2) { errorEl.textContent = 'Indique un nom complet valide.'; return }
    const submit = modal.querySelector<HTMLButtonElement>('button[type="submit"]')!
    submit.disabled = true
    submit.querySelector('span')!.textContent = 'Enregistrement…'
    let avatarUrl = removeAvatar ? null : currentProfile?.avatar_url || null
    let avatarStoredLocally = false
    let avatarUploadedRemotely = false
    if (file) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        errorEl.textContent = 'Choisis une image JPG, PNG ou WebP.'
        submit.disabled = false
        submit.querySelector('span')!.textContent = 'Enregistrer'
        return
      }
      if (file.size > 5 * 1024 * 1024) {
        errorEl.textContent = 'La photo ne doit pas dépasser 5 Mo.'
        submit.disabled = false
        submit.querySelector('span')!.textContent = 'Enregistrer'
        return
      }
      const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
      const path = `${session.user.id}/${Date.now()}.${extension}`
      const uploaded = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type })
      if (uploaded.error) {
        console.error('Could not upload profile avatar:', uploaded.error)
        try {
          avatarUrl = await makeLocalAvatar(file)
          localStorage.setItem(localAvatarKey(session.user.id), avatarUrl)
          avatarStoredLocally = true
        } catch (localError) {
          console.error('Could not store profile avatar locally:', localError)
          errorEl.textContent = 'Impossible d’enregistrer la photo. Vérifie l’espace disponible sur cet appareil.'
          submit.disabled = false
          submit.querySelector('span')!.textContent = 'Enregistrer'
          return
        }
      } else {
        avatarUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
        avatarUploadedRemotely = true
      }
    }
    const previousAvatarUrl = currentProfile?.avatar_url
    const { error: authError } = await supabase.auth.updateUser({
      data: { full_name: name, avatar_url: avatarUrl?.startsWith('data:') ? null : avatarUrl },
    })
    if (authError) {
      errorEl.textContent = 'Impossible de modifier le profil. Vérifie ta connexion puis réessaie.'
      submit.disabled = false
      return
    }
    if (removeAvatar || avatarUploadedRemotely) localStorage.removeItem(localAvatarKey(session.user.id))
    const { error: profileError } = await supabase.from('profiles').upsert({
      id: session.user.id,
      full_name: name,
      avatar_url: avatarUrl?.startsWith('data:') ? null : avatarUrl,
      created_at: session.user.created_at,
    })
    if (profileError) {
      console.error('Could not save profile row:', profileError)
      if (!['42P01', 'PGRST205'].includes(profileError.code || '')) {
        currentProfile = {
          ...profileFromSession(session),
          full_name: name,
          avatar_url: avatarUrl,
        }
        if (removeAvatar) localStorage.removeItem(localAvatarKey(session.user.id))
        if (removeAvatar && previousAvatarUrl) {
          const marker = '/avatars/'
          const index = previousAvatarUrl.indexOf(marker)
          if (index >= 0) {
            const oldPath = previousAvatarUrl.slice(index + marker.length).split('?')[0]
            const { error: removeError } = await supabase.storage.from('avatars').remove([decodeURIComponent(oldPath)])
            if (removeError) console.error('Could not remove previous profile avatar:', removeError)
          }
        }
        errorEl.textContent = 'Ton nom a été modifié, mais la synchronisation du profil a échoué.'
        submit.disabled = false
        submit.querySelector('span')!.textContent = 'Enregistrer'
        return
      }
    }
    currentProfile = {
      ...profileFromSession(session),
      full_name: name,
      avatar_url: avatarUrl,
    }
    close()
    renderApp()
    if (profileError) {
      openModal(
        'Nom mis à jour',
        avatarStoredLocally
          ? 'Ton profil est enregistré. La photo est stockée sur cet appareil; exécute les migrations Supabase pour activer sa synchronisation.'
          : 'Tes informations sont enregistrées sur le compte. Exécute les migrations Supabase pour activer la synchronisation du profil et des photos.',
        'Compris',
      )
    } else if (avatarStoredLocally) {
      showToast('Photo enregistrée sur cet appareil. Elle sera synchronisée après la configuration du stockage Supabase.')
    }
  })
}

const logout = async () => {
  if (activationClockTimer !== null) {
    window.clearInterval(activationClockTimer)
    activationClockTimer = null
  }
  await supabase.auth.signOut()
  currentSession = null
  currentProfile = null
  accountDevices = []
  accountSessions = []
  pendingSessionRequest = null
  deviceLoadGeneration += 1
  sessionLoadGeneration += 1
  deviceLoadError = ''
  sessionLoadError = ''
  devicesLoading = false
  sessionsLoading = false
  demoWallet = { entries: [], activationSession: null, notifications: [] }
  auth()
}

const openModal = (title: string, copy: string, action: string) => {
  const modal = document.createElement('div')
  modal.className = 'modal-backdrop'
  modal.innerHTML = `<div class="modal-sheet"><button class="modal-close" aria-label="Fermer">×</button><div class="modal-icon">${icon('wifi', 24)}</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy).replaceAll('\n', '<br>')}</p><button class="primary full modal-action">${escapeHtml(action)}</button></div>`
  overlayHost().appendChild(modal)
  requestAnimationFrame(() => modal.classList.add('open'))
  const close = () => { modal.classList.remove('open'); setTimeout(() => modal.remove(), 220) }
  modal.querySelector('.modal-close')?.addEventListener('click', close)
  modal.querySelector('.modal-action')?.addEventListener('click', close)
  modal.addEventListener('click', (event) => { if (event.target === modal) close() })
  return modal
}

let toastTimer = 0
const showToast = (message: string, tone: 'success' | 'error' = 'success') => {
  document.querySelector('.toast')?.remove()
  const toast = document.createElement('div')
  toast.className = `toast ${tone}`
  toast.setAttribute('role', tone === 'error' ? 'alert' : 'status')
  toast.textContent = message
  overlayHost().appendChild(toast)
  requestAnimationFrame(() => toast.classList.add('visible'))
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast.classList.remove('visible')
    setTimeout(() => toast.remove(), 220)
  }, 3200)
}

const updatePassword = () => {
  app.innerHTML = `
    <main class="auth-screen">
      <div class="auth-orb"></div>
      <div class="brand-mark auth-logo"><span class="brand-d">${icon('wifi', 20)}</span><b>Data</b><strong>Plus</strong></div>
      <div class="auth-card reset-card">
        <span class="eyebrow">NOUVEAU MOT DE PASSE</span>
        <h1>Choisis ton<br>nouveau mot de passe.</h1>
        <form id="new-password-form">
          <label>Nouveau mot de passe<div class="field">${icon('lock', 19)}<input id="new-password" type="password" autocomplete="new-password" minlength="8"></div></label>
          <label>Confirmation<div class="field">${icon('lock', 19)}<input id="new-password-confirm" type="password" autocomplete="new-password" minlength="8"></div></label>
          <p class="form-error" id="new-password-error" role="alert"></p>
          <button class="primary full" type="submit"><span>Confirmer</span>${icon('check', 19)}</button>
        </form>
      </div>
    </main>`
  document.querySelector('#new-password-form')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const password = (document.querySelector('#new-password') as HTMLInputElement).value
    const confirm = (document.querySelector('#new-password-confirm') as HTMLInputElement).value
    const errorEl = document.querySelector('#new-password-error')!
    if (password.length < 8) { errorEl.textContent = 'Le mot de passe doit contenir au moins 8 caractères.'; return }
    if (password !== confirm) { errorEl.textContent = 'Les mots de passe ne correspondent pas.'; return }
    setAuthLoading('#new-password-form', true)
    const { error } = await supabase.auth.updateUser({ password })
    setAuthLoading('#new-password-form', false)
    if (error) { errorEl.textContent = 'Impossible de modifier le mot de passe.'; return }
    openModal('Mot de passe réinitialisé', 'Tu peux maintenant te connecter avec ton nouveau mot de passe.', 'Continuer')
    setTimeout(() => { currentSession = null; auth() }, 1700)
  })
}

supabase.auth.onAuthStateChange((_event, session) => {
  if (_event === 'PASSWORD_RECOVERY') {
    currentSession = session
    updatePassword()
  } else if (_event === 'SIGNED_OUT') {
    currentSession = null
    currentProfile = null
    accountDevices = []
    accountSessions = []
    pendingSessionRequest = null
    deviceLoadGeneration += 1
    sessionLoadGeneration += 1
    deviceLoadError = ''
    sessionLoadError = ''
    devicesLoading = false
    sessionsLoading = false
  } else if (session) {
    if (currentSession?.user.id !== session.user.id) {
      accountDevices = []
      accountSessions = []
      pendingSessionRequest = null
      deviceLoadGeneration += 1
      sessionLoadGeneration += 1
      deviceLoadError = ''
      sessionLoadError = ''
      devicesLoading = false
      sessionsLoading = false
    }
    currentSession = session
  }
})

splash()
