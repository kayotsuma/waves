import { Fragment, useMemo } from 'react'
import type { HomeSection } from '@shared/types'
import { useSettings } from '@/store/settings'
import { Clipboard, Clock, Download, Flame, Heart, Link2, ListMusic, Sparkles } from 'lucide-react'
import { Card, Mosaic } from '@/components/Cards'
import { YearPromo } from '@/components/Wrapped'
import { playlistTracks } from '@/lib/collections'
import { fmtBytes, fmtDuration, tracksWord } from '@/lib/format'
import { useLibrary } from '@/store/library'
import { usePlayer } from '@/store/player'
import { useUI } from '@/store/ui'

function greeting(): string {
  const h = new Date().getHours()
  return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'
}

export function HomeView() {
  const tracks = useLibrary((s) => s.tracks)
  const playlists = useLibrary((s) => s.playlists)
  const byId = useLibrary((s) => s.byId)
  const navigate = useUI((s) => s.navigate)
  const openImport = useUI((s) => s.openImport)
  const layout = useSettings((s) => s.settings.appearance.home)

  const recent = useMemo(() => [...tracks].sort((a, b) => b.addedAt - a.addedAt).slice(0, 18), [tracks])
  const top = useMemo(() => tracks.filter((t) => t.plays > 0).sort((a, b) => b.plays - a.plays).slice(0, 18), [tracks])
  const stats = useMemo(
    () => ({
      time: tracks.reduce((s, t) => s + t.duration, 0),
      size: tracks.reduce((s, t) => s + t.size, 0),
      lossless: tracks.filter((t) => t.lossless).length
    }),
    [tracks]
  )

  const playOne = (id: string, list: string[]) => usePlayer.getState().playTracks(list, Math.max(0, list.indexOf(id)))

  if (!tracks.length) {
    return (
      <div className="view scroll">
        <div className="hero">
          <span className="hero-badge"><Sparkles size={14} /> Wave</span>
          <h1>Ваша музыка — на вашем диске</h1>
          <p>
            Вставьте ссылку на трек или плейлист из YouTube, SoundCloud, Spotify, Apple Music, Deezer или Яндекс Музыки. Wave скачает аудио в лучшем
            доступном качестве, найдёт текст и включит караоке.
          </p>
          <div className="hero-actions">
            <button className="btn primary lg" onClick={() => openImport()}><Link2 size={18} /> Добавить по ссылке</button>
            <button className="btn lg" onClick={async () => {
              const text = await navigator.clipboard.readText().catch(() => '')
              openImport(/^(https?:|spotify:)/i.test(text.trim()) ? text.trim() : '')
            }}><Clipboard size={17} /> Из буфера обмена</button>
          </div>
          <ul className="hero-tips">
            <li><Download size={15} /> Ссылку можно вставить прямо в окне приложения — Ctrl+V</li>
            <li><Download size={15} /> Звук сохраняется без перекодирования: Opus/AAC/FLAC как у источника</li>
            <li><Download size={15} /> Свои файлы можно перетащить в окно мышкой</li>
          </ul>
        </div>
      </div>
    )
  }

  const sections: Record<HomeSection, React.ReactNode> = {
    year: <YearPromo />,
    stats: (
      <div className="stats">
        <div><span>Треки</span><b>{tracks.length}</b></div>
        <div><span>Музыки</span><b>{fmtDuration(stats.time)}</b></div>
        <div><span>На диске</span><b>{fmtBytes(stats.size)}</b></div>
        <div><span>Без потерь</span><b className="accent">{stats.lossless}</b></div>
      </div>
    ),
    quick: (
      <div className="quick">
        <button className="quick-tile" onClick={() => navigate({ name: 'liked' })}>
          <span className="qt-art liked"><Heart size={26} fill="currentColor" /></span>
          <span className="qt-txt"><span className="qt-t1">Любимое</span><span className="qt-t2">{tracksWord(tracks.filter((t) => t.liked).length)}</span></span>
        </button>
        {[...playlists].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5).map((p) => {
          const list = playlistTracks(p, byId)
          return (
            <button key={p.id} className="quick-tile" onClick={() => navigate({ name: 'playlist', id: p.id })}>
              <span className="qt-art"><Mosaic tracks={list} size={64} radius={0} /></span>
              <span className="qt-txt"><span className="qt-t1">{p.name}</span><span className="qt-t2">{tracksWord(list.length)}</span></span>
            </button>
          )
        })}
      </div>
    ),
    recent: (
      <section className="shelf">
        <h2><Clock size={20} /> Недавно добавлено</h2>
        <div className="row-scroll">
          {recent.map((t) => (
            <Card key={t.id} tracks={[t]} title={t.title} subtitle={t.artist} onOpen={() => playOne(t.id, recent.map((x) => x.id))} onPlay={() => playOne(t.id, recent.map((x) => x.id))} />
          ))}
        </div>
      </section>
    ),
    top: top.length > 0 && (
      <section className="shelf">
        <h2><Flame size={20} /> Чаще всего слушаете</h2>
        <div className="row-scroll">
          {top.map((t) => (
            <Card key={t.id} tracks={[t]} title={t.title} subtitle={`${t.artist} · ${t.plays}×`} onOpen={() => playOne(t.id, top.map((x) => x.id))} onPlay={() => playOne(t.id, top.map((x) => x.id))} />
          ))}
        </div>
      </section>
    ),
    playlists: playlists.length > 0 && (
      <section className="shelf">
        <h2><ListMusic size={20} /> Плейлисты</h2>
        <div className="row-scroll">
          {playlists.map((p) => {
            const list = playlistTracks(p, byId)
            return (
              <Card key={p.id} tracks={list} title={p.name} subtitle={tracksWord(list.length)} onOpen={() => navigate({ name: 'playlist', id: p.id })} onPlay={() => list.length && usePlayer.getState().playTracks(list.map((t) => t.id))} />
            )
          })}
        </div>
      </section>
    )
  }

  return (
    <div className="view scroll home">
      <div className="view-head"><h1>{greeting()}</h1></div>
      {layout.filter((h) => h.visible).map((h) => (
        <Fragment key={h.id}>{sections[h.id]}</Fragment>
      ))}
    </div>
  )
}
