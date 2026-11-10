import { useMemo } from 'react'
import { ChevronLeft, ChevronRight, Disc3, Download, Heart, Home, Library, ListMusic, Mic2, Music2, PanelLeft, Plus, Search, Settings, Waves, X } from 'lucide-react'
import { activeStatuses, useDownloads } from '@/store/downloads'
import { useLibrary } from '@/store/library'
import { usePlayer } from '@/store/player'
import { useSettings } from '@/store/settings'
import { useUI, type Route } from '@/store/ui'
import { playlistTracks } from '@/lib/collections'
import { trackById } from '@/lib/actions'
import { fmtTime } from '@/lib/format'
import { Mosaic } from '@/components/Cards'
import { Cover } from './Cover'
import { Avatar } from './Showcase'
import { useProfile } from '@/store/profile'

const useActiveDownloads = () => useDownloads((s) => Object.values(s.jobs).filter((j) => activeStatuses.has(j.status)).length)

/** Поле поиска по библиотеке: в боковой панели или в верхней панели — как выбрано в настройках. */
function SearchField({ compact }: { compact?: boolean }) {
  const query = useUI((s) => s.query)
  const setQuery = useUI((s) => s.setQuery)
  return (
    <label className={`ios-search ${compact ? 'compact' : ''}`}>
      <Search size={16} />
      <input
        id="global-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={compact ? 'Поиск' : 'Поиск по библиотеке'}
        aria-label="Поиск по библиотеке"
        spellCheck={false}
      />
      {query ? (
        <button className="ios-search-clear" onClick={() => setQuery('')} aria-label="Очистить"><X size={12} strokeWidth={3} /></button>
      ) : (
        <kbd>Ctrl K</kbd>
      )}
    </label>
  )
}

export function Titlebar() {
  const { back, forward, goBack, goForward, openImport, route, navigate } = useUI()
  const placement = useSettings((s) => s.settings.appearance.searchPlacement)
  const sidebarFull = useUI((s) => s.sidebarFull)
  const active = useActiveDownloads()
  // в свёрнутой панели поиску места нет — показываем его сверху
  const searchTop = placement === 'toolbar' || !sidebarFull
  return (
    <header className="titlebar">
      <div className="tb-nav">
        <button className="glass-btn" onClick={goBack} disabled={!back.length} aria-label="Назад" title="Назад"><ChevronLeft size={20} /></button>
        <button className="glass-btn" onClick={goForward} disabled={!forward.length} aria-label="Вперёд" title="Вперёд"><ChevronRight size={20} /></button>
      </div>
      {searchTop ? <SearchField /> : <div className="tb-grow" />}
      <div className="tb-actions">
        <button className={`glass-btn dl-btn ${route.name === 'downloads' ? 'on' : ''}`} onClick={() => navigate({ name: 'downloads' })} aria-label={active ? `Загрузки: ${active}` : 'Загрузки'} title="Загрузки">
          <Download size={19} />
          {active > 0 && <em>{active}</em>}
        </button>
        <button className="btn primary add-btn" onClick={() => openImport()}>
          <Plus size={18} /> Добавить музыку
        </button>
      </div>
    </header>
  )
}

function NavRow({ to, icon, label, on, badge, count }: { to: Route; icon: React.ReactNode; label: string; on: boolean; badge?: number; count?: number }) {
  const navigate = useUI((s) => s.navigate)
  return (
    <button className={`sb-row ${on ? 'on' : ''}`} onClick={() => navigate(to)} aria-current={on ? 'page' : undefined} title={label}>
      <span className="sb-ico">{icon}</span>
      <span className="sb-label">{label}</span>
      {!!badge && <em className="sb-badge">{badge}</em>}
      {!badge && !!count && <small className="sb-count">{count}</small>}
    </button>
  )
}

function QueuePanel() {
  const queue = usePlayer((s) => s.queue)
  const index = usePlayer((s) => s.index)
  const currentId = usePlayer((s) => s.currentId)
  const setTab = useUI((s) => s.setLibTab)
  const upcoming = queue.slice(index + 1)
  const current = trackById(currentId)
  return (
    <>
      <div className="sb-sec">
        <span className="sb-sec-title big">Очередь</span>
        <button className="sb-mini" onClick={() => setTab('playlists')} aria-label="Закрыть очередь" title="Закрыть"><X size={17} /></button>
      </div>
      <div className="sb-scroll">
        {current && (
          <>
            <h6 className="sb-cap">Сейчас играет</h6>
            <div className="sb-row track now">
              <span className="sb-art"><Cover track={current} size={36} radius={7} /></span>
              <span className="sb-txt"><b>{current.title}</b><small>{current.artist}</small></span>
            </div>
          </>
        )}
        <div className="sb-cap-row">
          <h6 className="sb-cap">Далее · {upcoming.length}</h6>
          {upcoming.length > 0 && <button className="link" onClick={() => usePlayer.getState().clearUpcoming()}>Очистить</button>}
        </div>
        {upcoming.length === 0 && <p className="sb-empty">В очереди больше ничего нет.</p>}
        {upcoming.slice(0, 300).map((id, k) => {
          const t = trackById(id)
          if (!t) return null
          const i = index + 1 + k
          return (
            <div key={`${id}-${i}`} className="sb-row track q" onDoubleClick={() => usePlayer.getState().jumpTo(i)} title="Двойной щелчок — играть">
              <span className="sb-art"><Cover track={t} size={36} radius={7} /></span>
              <span className="sb-txt"><b>{t.title}</b><small>{t.artist} · {fmtTime(t.duration)}</small></span>
              <button className="sb-mini" onClick={() => usePlayer.getState().removeAt(i)} aria-label="Убрать из очереди"><X size={14} /></button>
            </div>
          )
        })}
      </div>
    </>
  )
}

/** Аватар и имя внизу боковой панели — вход в аккаунт и витрину, как в Discord. */
function UserChip({ on }: { on: boolean }) {
  const profile = useProfile((s) => s.profile)
  const navigate = useUI((s) => s.navigate)
  const current = usePlayer((s) => (s.playing && s.currentId ? useLibrary.getState().byId[s.currentId] : undefined))
  const name = profile?.displayName || 'Мой профиль'
  const line = current ? `♪ ${current.title}` : profile?.status ? `${profile.statusEmoji} ${profile.status}` : 'Витрина и итоги года'
  return (
    <button className={`user-chip ${on ? 'on' : ''}`} onClick={() => navigate({ name: 'account' })} title="Аккаунт и витрина">
      {profile ? <Avatar profile={profile} name={name} size={34} className="mini" /> : <span className="user-chip-ph" />}
      <span className="user-chip-t">
        <strong>{name}</strong>
        <small>{line}</small>
      </span>
    </button>
  )
}

function RailAvatar() {
  const profile = useProfile((s) => s.profile)
  return profile ? <Avatar profile={profile} name={profile.displayName || 'Я'} size={28} className="mini" /> : <span className="user-chip-ph" />
}

function FullSidebar() {
  const route = useUI((s) => s.route)
  const navigate = useUI((s) => s.navigate)
  const openModal = useUI((s) => s.openModal)
  const setFull = useUI((s) => s.setSidebarFull)
  const tab = useUI((s) => s.libTab)
  const ap = useSettings((s) => s.settings.appearance)
  const tracks = useLibrary((s) => s.tracks)
  const playlists = useLibrary((s) => s.playlists)
  const byId = useLibrary((s) => s.byId)
  const active = useActiveDownloads()
  const likedCount = useMemo(() => tracks.filter((t) => t.liked).length, [tracks])
  const lists = useMemo(() => [...playlists].sort((a, b) => b.updatedAt - a.updatedAt), [playlists])
  const nav = ap.nav
  const libTab = route.name === 'library' ? route.tab ?? 'tracks' : null
  const anyLib = nav.liked || nav.tracks || nav.albums || nav.artists

  return (
    <>
      <div className="sb-head">
        <span className="brand">
          <span className="logo"><Waves size={18} strokeWidth={2.4} /></span>
          <span className="brand-name">Wave</span>
        </span>
        <button className="sb-mini" onClick={() => setFull(false)} aria-label="Свернуть панель" title="Свернуть"><PanelLeft size={19} /></button>
      </div>
      {ap.searchPlacement === 'sidebar' && <SearchField compact />}

      {tab === 'queue' ? (
        <QueuePanel />
      ) : (
        <div className="sb-scroll">
          {nav.home && <NavRow to={{ name: 'home' }} icon={<Home size={20} />} label="Главная" on={route.name === 'home'} />}
          {nav.downloads && <NavRow to={{ name: 'downloads' }} icon={<Download size={20} />} label="Загрузки" on={route.name === 'downloads'} badge={active} />}

          {anyLib && <div className="sb-sec"><span className="sb-sec-title">Медиатека</span></div>}
          {nav.liked && <NavRow to={{ name: 'liked' }} icon={<Heart size={20} />} label="Любимое" on={route.name === 'liked'} count={likedCount} />}
          {nav.tracks && <NavRow to={{ name: 'library', tab: 'tracks' }} icon={<Music2 size={20} />} label="Все треки" on={libTab === 'tracks'} count={tracks.length} />}
          {nav.albums && <NavRow to={{ name: 'library', tab: 'albums' }} icon={<Disc3 size={20} />} label="Альбомы" on={libTab === 'albums' || route.name === 'album'} />}
          {nav.artists && <NavRow to={{ name: 'library', tab: 'artists' }} icon={<Mic2 size={20} />} label="Исполнители" on={libTab === 'artists' || route.name === 'artist'} />}

          {nav.playlists && (
            <>
              <div className="sb-sec">
                <span className="sb-sec-title">Плейлисты</span>
                <button className="sb-mini accent" onClick={() => openModal({ kind: 'new-playlist', trackIds: [] })} aria-label="Создать плейлист" title="Создать плейлист"><Plus size={18} /></button>
              </div>
              {lists.map((p) => {
                const list = playlistTracks(p, byId)
                const on = route.name === 'playlist' && route.id === p.id
                return (
                  <button key={p.id} className={`sb-row pl ${on ? 'on' : ''}`} onClick={() => navigate({ name: 'playlist', id: p.id })} title={p.name}>
                    <span className="sb-art">{list.length ? <Mosaic tracks={list} size={30} radius={7} /> : <ListMusic size={16} />}</span>
                    <span className="sb-label">{p.name}</span>
                  </button>
                )
              })}
              {!playlists.length && <p className="sb-empty">Плейлистов пока нет — нажмите «+».</p>}
            </>
          )}
        </div>
      )}

      <div className="sb-foot">
        <UserChip on={route.name === 'account'} />
        <button className={`sb-gear ${route.name === 'settings' ? 'on' : ''}`} onClick={() => navigate({ name: 'settings' })} aria-label="Настройки" title="Настройки"><Settings size={19} /></button>
      </div>
    </>
  )
}

function RailSidebar() {
  const route = useUI((s) => s.route)
  const setFull = useUI((s) => s.setSidebarFull)
  const nav = useSettings((s) => s.settings.appearance.nav)
  const active = useActiveDownloads()
  const is = (name: Route['name']) => route.name === name
  const Item = ({ to, icon, label, on, badge }: { to: Route; icon: React.ReactNode; label: string; on: boolean; badge?: number }) => (
    <button className={`rail-btn ${on ? 'on' : ''}`} onClick={() => useUI.getState().navigate(to)} title={label} aria-label={label} aria-current={on ? 'page' : undefined}>
      {icon}
      {!!badge && <em>{badge}</em>}
    </button>
  )
  return (
    <>
      <button className="rail-btn" onClick={() => setFull(true)} aria-label="Развернуть панель" title="Развернуть"><PanelLeft size={21} /></button>
      <span className="rail-sep" />
      {nav.home && <Item to={{ name: 'home' }} icon={<Home size={21} />} label="Главная" on={is('home')} />}
      <Item to={{ name: 'library', tab: 'tracks' }} icon={<Library size={21} />} label="Медиатека" on={is('library') || is('album') || is('artist') || is('playlist')} />
      {nav.liked && <Item to={{ name: 'liked' }} icon={<Heart size={21} />} label="Любимое" on={is('liked')} />}
      {nav.downloads && <Item to={{ name: 'downloads' }} icon={<Download size={21} />} label="Загрузки" on={is('downloads')} badge={active} />}
      <span className="rail-grow" />
      <Item to={{ name: 'settings' }} icon={<Settings size={21} />} label="Настройки" on={is('settings')} />
      <Item to={{ name: 'account' }} icon={<RailAvatar />} label="Аккаунт" on={is('account') || is('user')} />
    </>
  )
}

export function Sidebar() {
  const full = useUI((s) => s.sidebarFull)
  return <aside className={`sidebar glass ${full ? 'is-full' : 'is-rail'}`}>{full ? <FullSidebar /> : <RailSidebar />}</aside>
}
