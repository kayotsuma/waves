import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, LayoutGrid, ListPlus, Pause, Play, RotateCcw, Sparkles, X } from 'lucide-react'
import { newBlock } from '@shared/profile'
import { coverUrl, plural } from '@/lib/format'
import { fmtInt, minutesWord, MONTHS, MONTHS_GEN, MONTHS_SHORT, playsWord, yearSummary, yearsAvailable, type YearSummary } from '@/lib/stats'
import { useLibrary } from '@/store/library'
import { usePlayer } from '@/store/player'
import { useProfile } from '@/store/profile'
import { useUI } from '@/store/ui'
import { Icon } from './Showcase'

const DURATION = 8000

/** Число, «набегающее» от нуля при появлении слайда. */
function useCountUp(target: number, ms = 1600): number {
  const [v, setV] = useState(0)
  useEffect(() => {
    let raf = 0
    const t0 = performance.now()
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      setV(target * (1 - (1 - k) ** 3))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

function Count({ value, className }: { value: number; className?: string }) {
  const v = useCountUp(value)
  return <span className={className}>{fmtInt(v)}</span>
}

function Art({ id, round, className = '' }: { id?: string; round?: boolean; className?: string }) {
  const t = useLibrary((s) => (id ? s.byId[id] : undefined))
  const url = coverUrl(t)
  return <span className={`wr-art ${round ? 'round' : ''} ${className}`}>{url ? <img src={url} alt="" /> : <span className="wr-art-fb"><Sparkles size={40} /></span>}</span>
}

type SlideId = 'intro' | 'empty' | 'minutes' | 'first' | 'artist' | 'artists' | 'track' | 'tracks' | 'clock' | 'months' | 'library' | 'persona' | 'summary'

function slidesFor(s: YearSummary): SlideId[] {
  if (s.plays === 0 && s.minutes === 0) return ['intro', 'empty']
  const out: SlideId[] = ['intro', 'minutes']
  if (s.firstPlay) out.push('first')
  if (s.topArtists[0]) out.push('artist')
  if (s.topArtists.length >= 3) out.push('artists')
  if (s.topTracks[0]) out.push('track')
  if (s.topTracks.length >= 3) out.push('tracks')
  if (s.agg.historyPlays >= 10) out.push('clock')
  if (s.months.filter((m) => m > 0).length >= 2) out.push('months')
  if (s.newTracks > 0) out.push('library')
  out.push('persona', 'summary')
  return out
}

const dayPart = (h: number) => (h < 5 ? 'ночь' : h < 12 ? 'утро' : h < 18 ? 'день' : 'вечер')

function RadialClock({ hours }: { hours: number[] }) {
  const max = Math.max(...hours, 1)
  const top = hours.indexOf(Math.max(...hours))
  return (
    <svg className="wr-clock" viewBox="-110 -110 220 220" aria-hidden>
      <circle r="40" className="wr-clock-core" />
      {hours.map((v, h) => {
        const a = ((h / 24) * 360 - 90) * (Math.PI / 180)
        const len = 12 + 54 * (v / max)
        const r0 = 46
        return (
          <line
            key={h}
            x1={Math.cos(a) * r0}
            y1={Math.sin(a) * r0}
            x2={Math.cos(a) * (r0 + len)}
            y2={Math.sin(a) * (r0 + len)}
            className={h === top ? 'top' : ''}
            style={{ animationDelay: `${h * 30}ms` }}
          />
        )
      })}
      {[0, 6, 12, 18].map((h) => {
        const a = ((h / 24) * 360 - 90) * (Math.PI / 180)
        return <text key={h} x={Math.cos(a) * 30} y={Math.sin(a) * 30 + 4}>{h}</text>
      })}
    </svg>
  )
}

function Bars({ values, labels, hi }: { values: number[]; labels: string[]; hi?: number | null }) {
  const max = Math.max(...values, 1)
  return (
    <div className="wr-bars">
      {values.map((v, i) => (
        <div key={i} className={`wr-bar ${i === hi ? 'hi' : ''}`}>
          <i style={{ height: `${4 + 96 * (v / max)}%`, animationDelay: `${i * 50}ms` }} />
          <span>{labels[i]}</span>
        </div>
      ))}
    </div>
  )
}

function Slide({ id, s, years, onYear }: { id: SlideId; s: YearSummary; years: number[]; onYear: (y: number) => void }) {
  const play = (ids: string[]) => {
    const byId = useLibrary.getState().byId
    const have = ids.filter((x) => byId[x])
    if (have.length) usePlayer.getState().playTracks(have)
  }
  const hours = Math.round(s.minutes / 60)
  switch (id) {
    case 'intro':
      return (
        <div className="wr-c wr-intro">
          <span className="wr-kicker">Wave · итоги года</span>
          <h1 className="wr-mega">{s.year}</h1>
          <p className="wr-lead">Год в музыке. Посмотрим, каким он был.</p>
          {years.length > 1 && (
            <div className="wr-years" onClick={(e) => e.stopPropagation()}>
              {years.map((y) => <button key={y} className={y === s.year ? 'on' : ''} onClick={() => onYear(y)}>{y}</button>)}
            </div>
          )}
          <span className="wr-hint">Нажмите, чтобы продолжить →</span>
        </div>
      )
    case 'empty':
      return (
        <div className="wr-c">
          <span className="wr-kicker">Пока тихо</span>
          <h2 className="wr-h">Итоги появятся, когда зазвучит музыка</h2>
          <p className="wr-lead">Wave записывает, что и когда вы слушаете. Включите что-нибудь — и здесь появится ваш год.</p>
        </div>
      )
    case 'minutes':
      return (
        <div className="wr-c">
          <span className="wr-kicker">За {s.year} год вы послушали</span>
          <Count value={s.minutes} className="wr-num" />
          <span className="wr-unit">{minutesWord(s.minutes)} музыки</span>
          <p className="wr-lead">
            {hours >= 24 ? `Это ${fmtInt(hours)} ${plural(hours, 'час', 'часа', 'часов')} — или ${fmtInt(Math.round(hours / 24))} ${plural(Math.round(hours / 24), 'сутки', 'суток', 'суток')} без перерыва.` : `Это ${fmtInt(hours)} ${plural(hours, 'час', 'часа', 'часов')} чистого звука.`}
          </p>
          <div className="wr-trio">
            <span><b>{fmtInt(s.plays)}</b>{playsWord(s.plays)}</span>
            <span><b>{fmtInt(s.uniqueTracks)}</b>{plural(s.uniqueTracks, 'трек', 'трека', 'треков')}</span>
            <span><b>{fmtInt(s.uniqueArtists)}</b>{plural(s.uniqueArtists, 'исполнитель', 'исполнителя', 'исполнителей')}</span>
          </div>
          {s.approx && <p className="wr-note">Часть цифр — по счётчикам прослушиваний: подробная история ведётся с {new Date(s.since).getDate()} {MONTHS_GEN[new Date(s.since).getMonth()]} {new Date(s.since).getFullYear()}.</p>}
        </div>
      )
    case 'first': {
      const f = s.firstPlay!
      const d = new Date(f.at)
      return (
        <div className="wr-c">
          <span className="wr-kicker">Год начался с</span>
          <Art id={f.id} className="wr-art-md pop" />
          <h2 className="wr-h">{f.meta.title}</h2>
          <p className="wr-sub">{f.meta.artist}</p>
          <p className="wr-lead">{d.getDate()} {MONTHS_GEN[d.getMonth()]}, {String(d.getHours()).padStart(2, '0')}:{String(d.getMinutes()).padStart(2, '0')}</p>
        </div>
      )
    }
    case 'artist': {
      const a = s.topArtists[0]
      const pct = s.plays ? Math.round((a.plays / s.plays) * 100) : 0
      return (
        <div className="wr-c">
          <span className="wr-kicker">Исполнитель года</span>
          <span className="wr-ring"><Art id={a.topId} round className="wr-art-lg pop" /></span>
          <h2 className="wr-h xl">{a.name}</h2>
          <p className="wr-lead">
            {fmtInt(a.plays)} {playsWord(a.plays)} · {fmtInt(a.seconds / 60)} {minutesWord(a.seconds / 60)}
            {pct >= 3 && <><br />Это {pct}% всей вашей музыки за год.</>}
          </p>
        </div>
      )
    }
    case 'artists':
      return (
        <div className="wr-c">
          <span className="wr-kicker">Ваша пятёрка исполнителей</span>
          <ol className="wr-rank">
            {s.topArtists.slice(0, 5).map((a, i) => (
              <li key={a.name} style={{ animationDelay: `${150 + i * 120}ms` }}>
                <span className="wr-rank-n">{i + 1}</span>
                <Art id={a.topId} round />
                <span className="wr-rank-t"><strong>{a.name}</strong><small>{fmtInt(a.plays)} {playsWord(a.plays)}</small></span>
              </li>
            ))}
          </ol>
        </div>
      )
    case 'track': {
      const t = s.topTracks[0]
      return (
        <div className="wr-c">
          <span className="wr-kicker">Песня года</span>
          <span className="wr-vinyl"><Art id={t.id} className="wr-art-lg pop" /><i /></span>
          <h2 className="wr-h">{t.meta.title}</h2>
          <p className="wr-sub">{t.meta.artist}</p>
          <p className="wr-lead">{fmtInt(t.plays)} {plural(t.plays, 'раз', 'раза', 'раз')} · {fmtInt(t.seconds / 60)} {minutesWord(t.seconds / 60)}</p>
          {useLibrary.getState().byId[t.id] && <button className="wr-btn" onClick={(e) => { e.stopPropagation(); play([t.id]) }}><Play size={16} fill="currentColor" /> Включить</button>}
        </div>
      )
    }
    case 'tracks':
      return (
        <div className="wr-c">
          <span className="wr-kicker">Топ-5 песен</span>
          <ol className="wr-rank">
            {s.topTracks.slice(0, 5).map((t, i) => (
              <li key={t.id} style={{ animationDelay: `${150 + i * 120}ms` }}>
                <span className="wr-rank-n">{i + 1}</span>
                <Art id={t.id} />
                <span className="wr-rank-t"><strong>{t.meta.title}</strong><small>{t.meta.artist} · {fmtInt(t.plays)}×</small></span>
              </li>
            ))}
          </ol>
          <button className="wr-btn ghost" onClick={(e) => { e.stopPropagation(); play(s.topTracks.slice(0, 50).map((t) => t.id)) }}><Play size={16} fill="currentColor" /> Слушать топ года</button>
        </div>
      )
    case 'clock': {
      const top = s.hours.indexOf(Math.max(...s.hours))
      return (
        <div className="wr-c">
          <span className="wr-kicker">Ваше время</span>
          <h2 className="wr-h xl">{dayPart(top)}</h2>
          <RadialClock hours={s.hours} />
          <p className="wr-lead">Чаще всего музыка играла около {String(top).padStart(2, '0')}:00.</p>
        </div>
      )
    }
    case 'months': {
      const m = s.topMonth ?? 0
      return (
        <div className="wr-c">
          <span className="wr-kicker">Самый музыкальный месяц</span>
          <h2 className="wr-h xl">{MONTHS[m]}</h2>
          <Bars values={s.months} labels={MONTHS_SHORT.map((x) => x[0].toUpperCase())} hi={m} />
          <p className="wr-lead">
            {fmtInt(s.months[m])} {minutesWord(s.months[m])} за месяц.
            {s.topDay && (() => {
              const [y, mm, d] = s.topDay.key.split('-').map(Number)
              return <><br />Рекорд дня — {d} {MONTHS_GEN[mm - 1]}{y !== s.year ? ` ${y}` : ''}: {fmtInt(s.topDay.minutes)} {minutesWord(s.topDay.minutes)}.</>
            })()}
          </p>
        </div>
      )
    }
    case 'library':
      return (
        <div className="wr-c">
          <span className="wr-kicker">Медиатека росла</span>
          <Count value={s.newTracks} className="wr-num" />
          <span className="wr-unit">{plural(s.newTracks, 'новый трек', 'новых трека', 'новых треков')}</span>
          <Bars values={s.addedByMonth} labels={MONTHS_SHORT.map((x) => x[0].toUpperCase())} hi={s.addedByMonth.indexOf(Math.max(...s.addedByMonth))} />
          {s.newArtists > 0 && <p className="wr-lead">И {fmtInt(s.newArtists)} {plural(s.newArtists, 'новый исполнитель', 'новых исполнителя', 'новых исполнителей')}, которых раньше не было.</p>}
        </div>
      )
    case 'persona':
      return (
        <div className="wr-c">
          <span className="wr-kicker">Ваш музыкальный тип</span>
          <span className="wr-persona-ic pop"><Icon name={s.persona.icon} size={64} /></span>
          <h2 className="wr-h xl">{s.persona.title}</h2>
          <p className="wr-lead">{s.persona.desc}</p>
        </div>
      )
    case 'summary':
      return null
  }
}

function Summary({ s, onRestart }: { s: YearSummary; onRestart: () => void }) {
  const card = useRef<HTMLDivElement>(null)
  const toast = useUI((st) => st.toast)
  const navigate = useUI((st) => st.navigate)
  const close = useProfile((st) => st.closeWrapped)
  const update = useProfile((st) => st.update)
  const profile = useProfile((st) => st.profile)
  const name = profile?.displayName
  const hasBlock = profile?.blocks.some((b) => b.kind === 'year' && (b.year || new Date().getFullYear()) === s.year)

  const save = async () => {
    const r = card.current?.getBoundingClientRect()
    if (!r) return
    const z = Number(document.documentElement.style.zoom) || 1
    const path = await window.wave.app.saveCapture({ x: r.x * z, y: r.y * z, width: r.width * z, height: r.height * z }, `Wave ${s.year}`)
    if (path) toast('Картинка сохранена', 'success')
  }
  const playlist = async () => {
    const byId = useLibrary.getState().byId
    const ids = s.topTracks.map((t) => t.id).filter((id) => byId[id])
    if (!ids.length) return
    const p = await window.wave.library.createPlaylist(`Лучшее за ${s.year}`, ids)
    toast(`Плейлист «${p.name}» создан`, 'success')
    close()
    navigate({ name: 'playlist', id: p.id })
  }
  const toShowcase = () => {
    update((p) => void p.blocks.unshift(newBlock('year', { year: s.year === new Date().getFullYear() ? 0 : s.year })))
    toast('Итоги добавлены на витрину', 'success')
  }

  return (
    <div className="wr-c wr-summary" onClick={(e) => e.stopPropagation()}>
      <div className="wr-card" ref={card}>
        <div className="wr-card-bg" />
        <header>
          <span className="wr-card-logo">Wave</span>
          <span className="wr-card-year">{s.year}</span>
        </header>
        {name && <p className="wr-card-name">{name}</p>}
        <div className="wr-card-persona"><Icon name={s.persona.icon} size={22} /> {s.persona.title}</div>
        <div className="wr-card-cols">
          <div>
            <h4>Исполнители</h4>
            <ol>{s.topArtists.slice(0, 5).map((a) => <li key={a.name}>{a.name}</li>)}</ol>
          </div>
          <div>
            <h4>Песни</h4>
            <ol>{s.topTracks.slice(0, 5).map((t) => <li key={t.id}>{t.meta.title}</li>)}</ol>
          </div>
        </div>
        <div className="wr-card-stats">
          <span><small>Минут</small><b>{fmtInt(s.minutes)}</b></span>
          <span><small>Треков</small><b>{fmtInt(s.uniqueTracks)}</b></span>
          <span><small>Исполнителей</small><b>{fmtInt(s.uniqueArtists)}</b></span>
        </div>
        <div className="wr-card-covers">
          {s.topArtists.slice(0, 5).map((a) => <Art key={a.name} id={a.topId} round />)}
        </div>
      </div>
      <div className="wr-actions">
        <button className="wr-btn" onClick={() => void save()}><Download size={16} /> Сохранить картинкой</button>
        <button className="wr-btn ghost" onClick={() => void playlist()} disabled={!s.topTracks.length}><ListPlus size={16} /> Плейлист «Лучшее за {s.year}»</button>
        {!hasBlock && <button className="wr-btn ghost" onClick={toShowcase}><LayoutGrid size={16} /> На витрину</button>}
        <button className="wr-btn ghost" onClick={onRestart}><RotateCcw size={16} /> Сначала</button>
      </div>
    </div>
  )
}

export function Wrapped() {
  const year = useProfile((s) => s.wrapped)
  if (year === null) return null
  return <WrappedInner key={year} year={year} />
}

function WrappedInner({ year }: { year: number }) {
  const info = useProfile((s) => s.info)
  const years = useProfile((s) => s.years)
  const rev = useProfile((s) => s.listensRev)
  const close = useProfile((s) => s.closeWrapped)
  const open = useProfile((s) => s.openWrapped)
  const tracks = useLibrary((s) => s.tracks)
  const s = useMemo(() => yearSummary({ info, years }, year, tracks), [info, years, year, tracks, rev])
  const allYears = useMemo(() => yearsAvailable({ info, years }, tracks), [info, years, tracks])
  const slides = useMemo(() => slidesFor(s), [s])
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const id = slides[Math.min(i, slides.length - 1)]
  const last = i >= slides.length - 1

  const go = (d: number) => setI((x) => Math.max(0, Math.min(slides.length - 1, x + d)))
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.code === 'Space') {
        e.preventDefault()
        setPaused((p) => !p)
      } else return
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [slides.length])

  return (
    <div className={`wr wr-${id} wr-p${slides.indexOf(id) % 6}`} role="dialog" aria-label={`Итоги ${year} года`}>
      <div className="wr-bg"><i /><i /><i /></div>
      <div className="wr-top">
        <div className="wr-progress">
          {slides.map((x, k) => (
            <span key={x} className={k < i ? 'done' : k === i ? 'cur' : ''}>
              {k === i && !last && <i key={`${x}-${i}`} style={{ animationDuration: `${DURATION}ms`, animationPlayState: paused ? 'paused' : 'running' }} onAnimationEnd={() => go(1)} />}
            </span>
          ))}
        </div>
        <div className="wr-tools">
          {!last && <button onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Продолжить' : 'Пауза'}>{paused ? <Play size={18} /> : <Pause size={18} />}</button>}
          <button onClick={close} aria-label="Закрыть"><X size={20} /></button>
        </div>
      </div>
      <div
        className="wr-stage"
        onClick={(e) => {
          if (last) return
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          go(e.clientX - r.left < r.width * 0.3 ? -1 : 1)
        }}
      >
        <div className="wr-slide" key={id}>
          {id === 'summary' ? <Summary s={s} onRestart={() => setI(0)} /> : <Slide id={id} s={s} years={allYears} onYear={(y) => open(y)} />}
        </div>
      </div>
      {i > 0 && <button className="wr-nav prev" onClick={() => go(-1)} aria-label="Назад"><ChevronLeft size={26} /></button>}
      {!last && <button className="wr-nav next" onClick={() => go(1)} aria-label="Дальше"><ChevronRight size={26} /></button>}
    </div>
  )
}

/** Карточка-приглашение на главной и в аккаунте. */
export function YearPromo({ compact }: { compact?: boolean }) {
  const info = useProfile((s) => s.info)
  const years = useProfile((s) => s.years)
  const openWrapped = useProfile((s) => s.openWrapped)
  const loadListens = useProfile((s) => s.loadListens)
  const tracks = useLibrary((s) => s.tracks)
  useEffect(() => void loadListens(), [])
  const y = new Date().getFullYear()
  const s = useMemo(() => (info ? yearSummary({ info, years }, y, tracks) : null), [info, years, tracks, y])
  const covers = s ? s.topArtists.slice(0, 4).map((a) => a.topId) : []
  return (
    <button className={`year-promo ${compact ? 'compact' : ''}`} onClick={() => openWrapped(y)}>
      <span className="yp-bg"><i /><i /></span>
      <span className="yp-text">
        <span className="yp-kicker"><Sparkles size={14} /> Итоги года</span>
        <strong>Ваш {y} в Wave</strong>
        <span className="yp-sub">{s && s.minutes > 0 ? `${fmtInt(s.minutes)} ${minutesWord(s.minutes)}${s.topArtists[0] ? ` · исполнитель года — ${s.topArtists[0].name}` : ''}` : 'Главные песни, исполнители и ваш музыкальный тип'}</span>
      </span>
      <span className="yp-covers">{covers.map((id, k) => <Art key={id + k} id={id} round />)}</span>
      <span className="yp-go"><Play size={18} fill="currentColor" /></span>
    </button>
  )
}
