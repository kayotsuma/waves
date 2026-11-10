# Сторонний код и идеи

## Riff — https://github.com/rootscripts/riff (MIT)

Часть возможностей Wave сделана по мотивам или на основе кода проекта **Riff**, распространяемого под лицензией MIT.
Код Wave написан заново на TypeScript/React; у Riff заимствованы идеи, форматы данных и порядок работы, перечисленные ниже.
Обязательства лицензии MIT (сохранить уведомление об авторских правах и текст лицензии) выполнены этим файлом.

| Возможность Wave | Файл | Что взято из Riff |
|---|---|---|
| Discord Rich Presence | `src/main/services/discord.ts` | формат активности (тип «Слушает», исполнитель в статусе, кнопка «Listen», запасной вариант без `status_display_type`), интервал переподключения 15 с, `src/main/discord.js` |
| Импорт из Deezer | `src/main/services/sources/deezer.ts` | обход постраничного ответа `api.deezer.com/playlist/{id}` и набор полей трека, `src/server/server.js` |
| Трёхпанельный каркас интерфейса | `src/renderer/src/styles/layout.css`, `components/Shell.tsx`, `InfoPanel.tsx`, `AudioPopover.tsx`, `Onboarding.tsx` | компоновка: панель «Библиотека» с вкладками слева, поиск сверху, «Сейчас играет» справа, окно «Аудио» с разделами, пошаговое приветствие; стили и код написаны заново |
| Вырезать фрагмент без потерь | `src/main/services/trim.ts` | идея встроенного аудиоредактора (обрезка без перекодирования с сохранением нового файла) |

## Другие зависимости

- **@material/material-color-utilities** (Apache-2.0, Google) — построение палитры темы «Material You» из цвета обложки.
- **@fontsource-variable/google-sans** (шрифт Google Sans, SIL OFL 1.1) — шрифт темы «Material You».
- **hls.js** (Apache-2.0, video-dev) — воспроизведение HLS-потоков SoundCloud для веб-треков.
- Остальные шрифты (Inter, Manrope, Space Grotesk) и библиотеки подключены через npm со своими лицензиями (OFL / MIT).

Что **не** взято из Riff: идентификатор приложения Discord (он принадлежит Riff — в Wave вы указываете собственный), ресурсы, названия и оформление.

### Текст лицензии Riff

    MIT License
    
    Copyright (c) 2026 rootscripts
    
    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:
    
    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.
    
    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
