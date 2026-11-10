import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Loader2, LogIn, Pencil, RefreshCw, Search, Settings2, Sparkles, Users } from 'lucide-react'
import type { ProfileListItem, PublicProfile, ShowcaseData, SyncStatus } from '@shared/types'
import { Avatar, Showcase, type ShowcaseActions } from '@/components/Showcase'
import { ShowcaseEditor } from '@/components/ShowcaseEditor'
import { YearPromo } from '@/components/Wrapped'
import { coverUrl } from '@/lib/format'
import { resolveShowcase } from '@/lib/showcase'
import { useLibrary } from '@/store/library'
import { usePlayer } from '@/store/player'
import { showcaseCtx, useProfile } from '@/store/profile'
import { useUI } from '@/store/ui'

const cleanErr = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Своя витрина: пересчитывается при правке профиля, смене трека и новой истории. */
function useOwnShowcase(): ShowcaseData | null {
  const profile = useProfile((s) => s.profile)
  const rev = useProfile((s) => s.listensRev)
  const tracks = useLibrary((s) => s.tracks)
  const playlists = useLibrary((s) => s.playlists)
  const byId = useLibrary((s) => s.byId)
  const currentId = usePlayer((s) => s.currentId)
  const playing = usePlayer((s) => s.playing)
  return useMemo(() => {
    if (!profile) return null
    const ctx = showcaseCtx()
    const cover = profile.banner.kind === 'cover' ? coverUrl(byId[profile.banner.trackId]) : undefined
    return { profile, resolved: resolveShowcase(profile, ctx), bannerCover: cover }
  }, [profile, rev, tracks, playlists, byId, currentId, playing])
}

export function ownActions(): ShowcaseActions {
  const ui = useUI.getState()
  return {
    onTrack: (id, all) => usePlayer.getState().playTracks(all.length ? all : [id], Math.max(0, all.indexOf(id))),
    onKey: (kind, key) => ui.navigate({ name: kind, key }),
    onYear: (y) => useProfile.getState().openWrapped(y),
    onLink: (url) => void window.wave.app.openExternal(url)
  }
}

function People({ me }: { me?: string }) {
  const navigate = useUI((s) => s.navigate)
  const [list, setList] = useState<ProfileListItem[] | null>(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const load = () => {
    setErr('')
    window.wave.profile.list().then(setList, (e) => setErr(cleanErr(e)))
  }
  useEffect(load, [])
  const others = (list ?? []).filter((p) => p.username.toLowerCase() !== me?.toLowerCase())
  return (
    <section className="acc-sec">
      <div className="acc-sec-h">
        <h2><Users size={20} /> Люди на сервере</h2>
        <form className="acc-find" onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate({ name: 'user', username: q.trim().replace(/^@/, '') }) }}>
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти по имени" spellCheck={false} />
        </form>
        <button className="icon-btn" onClick={load} aria-label="Обновить" title="Обновить"><RefreshCw size={17} /></button>
      </div>
      {err ? (
        <p className="acc-note err-text">{err}</p>
      ) : !list ? (
        <p className="acc-note"><Loader2 size={15} className="spin" /> Загружаю…</p>
      ) : !others.length ? (
        <p className="acc-note">Здесь пока никого — другие пользователи вашего сервера появятся, когда включат «Показывать витрину другим».</p>
      ) : (
        <div className="people">
          {others.map((p) => (
            <button key={p.username} className="person glass" onClick={() => navigate({ name: 'user', username: p.username })}>
              <Avatar profile={{ avatar: p.thumb ?? '', avatarShape: 'circle', avatarFrame: 'none' }} name={p.displayName || p.username} size={52} />
              <span className="person-t">
                <strong>{p.displayName || p.username}</strong>
                <small>@{p.username}</small>
                {p.nowPlaying ? <span className="person-np">♪ {p.nowPlaying}</span> : p.status ? <span>{p.statusEmoji} {p.status}</span> : null}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

export function AccountView() {
  const load = useProfile((s) => s.load)
  const loadListens = useProfile((s) => s.loadListens)
  const profile = useProfile((s) => s.profile)
  const pub = useProfile((s) => s.publish)
  const navigate = useUI((s) => s.navigate)
  const data = useOwnShowcase()
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [sync, setSync] = useState<SyncStatus | null>(null)
  const act = useMemo(ownActions, [])
  // в редакторе превью нужно место: правая панель закрывается и возвращается после
  useEffect(() => {
    if (!editing) return
    const ui = useUI.getState()
    const was = ui.infoOpen
    if (was) ui.setInfoOpen(false)
    return () => {
      if (was) useUI.getState().setInfoOpen(true)
    }
  }, [editing])

  useEffect(() => {
    if (!profile) void load()
    else void loadListens(true)
    void window.wave.sync.status().then(setSync)
    return window.wave.on('sync:status', setSync)
  }, [])

  if (!data) return <div className="view scroll" />

  if (editing) {
    return (
      <div className="acc-edit" onClick={() => setSelected(null)}>
        <ShowcaseEditor selected={selected} onSelect={setSelected} onDone={() => { setEditing(false); setSelected(null) }} />
        <div className="acc-preview scroll">
          <Showcase data={data} username={sync?.username} act={{}} editing selectedBlock={selected} onSelectBlock={setSelected} />
        </div>
      </div>
    )
  }

  return (
    <div className="view scroll acc">
      <div className="view-head acc-head">
        <h1>Аккаунт</h1>
      </div>
      <Showcase
        data={data}
        username={sync?.username}
        act={act}
        actions={
          <>
            <button className="btn primary" onClick={() => setEditing(true)}><Pencil size={16} /> Изменить витрину</button>
          </>
        }
      />
      {!data.profile.displayName && !data.profile.avatar && (
        <button className="acc-hint glass" onClick={() => setEditing(true)}>
          <Sparkles size={18} />
          <span><strong>Сделайте витрину своей</strong><small>Имя, аватар (можно GIF), баннер, цвета, эффекты и любые блоки — в любом порядке.</small></span>
        </button>
      )}

      <YearPromo />

      <section className="acc-sec">
        <div className="acc-sec-h"><h2><LogIn size={20} /> Аккаунт Wave</h2></div>
        <div className="acc-card glass">
          {sync?.signedIn ? (
            <>
              <span className="acc-card-t">
                <strong>@{sync.username}</strong>
                <small>{sync.server}</small>
                <small>{pub?.error ? <span className="err-text">{pub.error}</span> : data.profile.publish ? (pub?.published ? 'Витрина видна другим пользователям сервера' : 'Витрина скоро появится на сервере') : 'Витрина видна только вам'}</small>
              </span>
              <button className="btn" onClick={() => { setEditing(true) }}>Доступ</button>
              <button className="btn" onClick={() => navigate({ name: 'settings', tab: 'account' })}><Settings2 size={15} /> Синхронизация</button>
            </>
          ) : (
            <>
              <span className="acc-card-t">
                <strong>Вход не выполнен</strong>
                <small>Витрина и итоги работают и без аккаунта. Войдите, чтобы синхронизировать медиатеку и показывать витрину друзьям на своём сервере.</small>
              </span>
              <button className="btn primary" onClick={() => navigate({ name: 'settings', tab: 'account' })}><LogIn size={15} /> Войти</button>
            </>
          )}
        </div>
      </section>

      {sync?.signedIn && <People me={sync.username} />}
    </div>
  )
}

export function UserView({ username }: { username: string }) {
  const goBack = useUI((s) => s.goBack)
  const [p, setP] = useState<PublicProfile | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    setP(null)
    setErr('')
    window.wave.profile.fetch(username).then(setP, (e) => setErr(cleanErr(e)))
  }, [username])
  const act: ShowcaseActions = useMemo(() => ({ onLink: (url) => void window.wave.app.openExternal(url) }), [])
  return (
    <div className="view scroll acc">
      <div className="view-head acc-head">
        <button className="glass-btn" onClick={goBack} aria-label="Назад"><ArrowLeft size={18} /></button>
        <h1>@{username}</h1>
      </div>
      {err ? <p className="acc-note err-text">{err}</p> : !p ? <p className="acc-note"><Loader2 size={15} className="spin" /> Загружаю витрину…</p> : <Showcase data={p} username={p.username} act={act} />}
      {p && <p className="acc-note">Обновлено {new Date(p.updatedAt).toLocaleString()}</p>}
    </div>
  )
}
