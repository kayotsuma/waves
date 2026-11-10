import { AlertTriangle, Check, Link2, Loader2, RefreshCw, Trash2, X } from 'lucide-react'
import type { DownloadJob } from '@shared/types'
import { fmtSpeed, fmtTime } from '@/lib/format'
import { activeStatuses, useDownloads } from '@/store/downloads'
import { useUI } from '@/store/ui'
import { EmptyState } from './Common'

const STATUS: Record<DownloadJob['status'], string> = {
  queued: 'В очереди',
  matching: 'Ищу источник',
  downloading: 'Скачивание',
  processing: 'Обработка',
  done: 'Готово',
  error: 'Ошибка',
  canceled: 'Отменено'
}

function Job({ job }: { job: DownloadJob }) {
  const openModal = useUI((s) => s.openModal)
  const active = activeStatuses.has(job.status)
  return (
    <div className={`job ${job.status}`}>
      {job.item.coverUrl ? <img src={job.item.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="ph" />}
      <div className="txt">
        <div className="t1">{job.item.title}</div>
        <div className="t2">{job.item.artists.join(', ')}</div>
        {job.status === 'error' && <div className="err-text">{job.error}</div>}
        {job.status !== 'error' && (job.detail || job.status !== 'queued') && (
          <div className="t3">
            {STATUS[job.status]}
            {job.detail ? ` · ${job.detail}` : ''}
            {job.speed ? ` · ${fmtSpeed(job.speed)}` : ''}
            {job.eta ? ` · ещё ${fmtTime(job.eta)}` : ''}
          </div>
        )}
        {active && (
          <div className="bar"><i className={job.status === 'matching' || job.progress === 0 ? 'indet' : ''} style={{ width: `${job.progress}%` }} /></div>
        )}
      </div>
      <div className="job-state">
        {job.status === 'done' && <Check size={18} className="ok" />}
        {job.status === 'error' && <AlertTriangle size={18} className="bad" />}
        {active && <Loader2 size={16} className="spin" />}
      </div>
      <div className="job-actions">
        {job.status === 'error' && (
          <>
            <button className="icon-btn" title="Повторить" onClick={() => window.wave.downloads.retry(job.id)}><RefreshCw size={16} /></button>
            <button className="icon-btn" title="Указать ссылку на источник вручную" onClick={() => openModal({ kind: 'manual-url', jobId: job.id })}><Link2 size={16} /></button>
          </>
        )}
        {job.status === 'canceled' && <button className="icon-btn" title="Повторить" onClick={() => window.wave.downloads.retry(job.id)}><RefreshCw size={16} /></button>}
        {active && <button className="icon-btn" title="Отменить" onClick={() => window.wave.downloads.cancel(job.id)}><X size={16} /></button>}
      </div>
    </div>
  )
}

export function DownloadsView() {
  const jobs = useDownloads((s) => s.jobs)
  const tools = useDownloads((s) => s.tools)
  const list = Object.values(jobs).sort((a, b) => {
    const aa = activeStatuses.has(a.status) ? 0 : 1
    const bb = activeStatuses.has(b.status) ? 0 : 1
    return aa - bb || b.createdAt - a.createdAt
  })
  const activeCount = list.filter((j) => activeStatuses.has(j.status)).length
  const finished = list.length - activeCount

  return (
    <div className="view scroll">
      <div className="view-head">
        <h1>Загрузки</h1>
        <span className="muted">{activeCount ? `Идёт: ${activeCount}` : 'Нет активных'}</span>
        <div className="spacer" />
        {finished > 0 && (
          <button className="btn" onClick={() => window.wave.downloads.clearFinished()}><Trash2 size={15} /> Очистить завершённые</button>
        )}
      </div>

      {tools && tools.ytdlp.state !== 'ready' && (
        <div className={`note ${tools.ytdlp.state === 'error' ? 'err' : 'warn'}`}>
          {tools.ytdlp.state === 'downloading' ? <Loader2 size={15} className="spin" /> : <AlertTriangle size={15} />}
          <span>
            {tools.ytdlp.state === 'downloading'
              ? `Устанавливаю yt-dlp — загрузчик аудио… ${Math.round(tools.ytdlp.progress * 100)}%`
              : tools.ytdlp.state === 'error'
                ? `Не удалось установить yt-dlp: ${tools.ytdlp.message}`
                : 'yt-dlp не установлен'}
          </span>
          {tools.ytdlp.state !== 'downloading' && <button className="btn sm" onClick={() => window.wave.tools.ensure()}>Повторить</button>}
        </div>
      )}

      {list.length === 0 ? (
        <EmptyState title="Загрузок пока нет" text="Нажмите «Добавить музыку» и вставьте ссылку — здесь появится прогресс." />
      ) : (
        <div className="jobs">{list.map((j) => <Job key={j.id} job={j} />)}</div>
      )}
    </div>
  )
}
