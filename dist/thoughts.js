// What drifts inside the fly's head (scene.js, "inside the head"). Everything is lowercase on
// purpose: thoughts, not captions. Rendered exactly as written; {countdown} = S.countdownShort.
//   layer: ui | city | feed | search | fly | under   (under = the quiet undertow, the only warm colour: pink)
//   kind:  line | chip | bubble | notif | dialog | search | icon
//          (search entries are typed two letters at a time and stop on a blinking caret)
//   pict:  a pixel pictogram drawn next to the text (battery, nosignal, voice, eye, missed, satellite,
//          calendar, progress, code, alarm, plane, candles, stamp); icon: 'read' | 'captcha' | 'badge'
//          are pictogram-only entries, they only drift in the background
//   out:   an outgoing message bubble (mine), the others are incoming
//   btns:  dialog buttons; without it a dialog gets [отмена] and a greyed-out [выйти]
//   when:  section gate: boot | attempt | build   (attempt lines are the pops when the fly gives up)
//   echo:  a short echo of another line, only in the build
//   special: 'typing' (never resolves), 'count' (the badge counts up), 'stuck' (the 99% bar)

export const THOUGHTS = [
  { text: 'а в свою?', layer: 'under', kind: 'line' },
  { text: 'а голову ты дома не забыл?', layer: 'under', kind: 'line' },
  // ---------------------------------------------------------------- ui: interface shards
  { text: 'подключение…', layer: 'ui', kind: 'chip', when: 'boot' },
  { text: 'ищем спутники…', layer: 'ui', kind: 'chip', pict: 'satellite', when: 'boot' },
  { text: 'печатает…', layer: 'ui', kind: 'bubble', special: 'typing' },
  { icon: 'read', layer: 'ui', kind: 'icon' },                        // artist
  { icon: 'captcha', layer: 'ui', kind: 'icon' },                     // artist
  { icon: 'badge', layer: 'ui', kind: 'icon', special: 'count' },     // artist
  { text: 'был(а) недавно', layer: 'ui', kind: 'chip' },
  { text: 'голосовое · 4:37', layer: 'ui', kind: 'bubble', pict: 'voice' },
  { text: 'кружочек · 0:12', layer: 'ui', kind: 'bubble' },
  { text: 'ок.', layer: 'under', kind: 'bubble', out: true },
  { text: 'всё нормально)', layer: 'under', kind: 'bubble', out: true },
  { text: 'не могу говорить, перезвоню', layer: 'ui', kind: 'bubble' },
  { text: 'мама · пропущенный вызов', layer: 'ui', kind: 'notif', pict: 'missed' },
  { text: 'заряд 2%', layer: 'ui', kind: 'chip', pict: 'battery' },
  { text: 'нет сети', layer: 'ui', kind: 'chip', pict: 'nosignal' },
  { text: 'введите код из смс', layer: 'ui', kind: 'chip', pict: 'code' },
  { text: 'повторите попытку', layer: 'ui', kind: 'chip', when: 'attempt' },
  { text: 'что-то пошло не так', layer: 'ui', kind: 'chip', when: 'attempt' },
  { text: 'сохранить изменения?', layer: 'ui', kind: 'dialog', btns: ['нет', 'да'] },
  { text: 'напомнить позже', layer: 'ui', kind: 'chip' },
  { text: 'ещё 5 минут', layer: 'ui', kind: 'chip', pict: 'alarm' },
  { text: 'списание 399 ₽', layer: 'ui', kind: 'notif' },
  { text: 'хранилище заполнено', layer: 'ui', kind: 'notif' },
  { text: 'загрузка 99%', layer: 'ui', kind: 'icon', pict: 'progress', special: 'stuck', when: 'build' },
  { text: 'вы действительно хотите выйти?', layer: 'under', kind: 'dialog' },   // [отмена] [выйти — серая, неактивна]
  { text: 'сообщение удалено', layer: 'ui', kind: 'bubble' },
  { text: 'недоступно в вашем регионе', layer: 'ui', kind: 'chip' },
  { text: 'просмотрено · 1', layer: 'under', kind: 'chip', pict: 'eye' },
  { text: 'курьер будет через 7 мин', layer: 'ui', kind: 'notif' },
  { text: 'заказ ждёт в пункте выдачи', layer: 'ui', kind: 'notif' },
  { text: 'оцените поездку', layer: 'ui', kind: 'notif' },
  { text: 'обновление установится ночью', layer: 'ui', kind: 'notif' },
  { text: 'удалить у всех', layer: 'ui', kind: 'chip' },
  { text: 'вы в очереди: 14', layer: 'ui', kind: 'chip' },
  { text: 'нет свободных слотов', layer: 'under', kind: 'chip' },
  { text: 'такси · высокий спрос', layer: 'ui', kind: 'notif' },

  // ---------------------------------------------------------------- city: overheard life
  { text: 'малиновый раф', layer: 'city', kind: 'line' },            // artist
  { text: 'без сахара', layer: 'city', kind: 'line' },
  { text: 'раф', layer: 'city', kind: 'line', echo: true },
  { text: 'кофейня в центре', layer: 'city', kind: 'line' },         // artist
  { text: 'кофейня в це', layer: 'city', kind: 'line', echo: true },
  { text: 'уволиться', layer: 'city', kind: 'line' },
  { text: 'опять gps не работает', layer: 'city', kind: 'line' },    // artist
  { text: 'такси думает, что я во внуково', layer: 'city', kind: 'line', pict: 'plane' },
  { text: 'опять', layer: 'city', kind: 'line', echo: true },
  { text: 'апостили нужно проставить', layer: 'city', kind: 'line', pict: 'stamp' }, // artist
  { text: 'хозяйка поднимает аренду', layer: 'city', kind: 'line' },
  { text: 'самокат не завершает поездку', layer: 'city', kind: 'line' },
  { text: 'зонт остался в офисе', layer: 'city', kind: 'line' },
  { text: 'соседи сверлят', layer: 'city', kind: 'line' },
  { text: 'к стоматологу записаться', layer: 'city', kind: 'line' },
  { text: 'дождь до пятницы', layer: 'city', kind: 'line' },
  { text: 'кто вообще звонит по телефону', layer: 'city', kind: 'line' },
  { text: 'извините, я не местная', layer: 'under', kind: 'line' },
  { text: 'не моя остановка', layer: 'under', kind: 'line' },

  // ---------------------------------------------------------------- feed: internet meta
  { text: 'про что бы рилс снять', layer: 'feed', kind: 'line' },    // artist
  { text: 'опять какие-то прогревы', layer: 'feed', kind: 'line' },  // artist
  { text: 'прогре', layer: 'feed', kind: 'line', echo: true },
  { text: 'ии нас всех погубит', layer: 'feed', kind: 'line' },      // artist
  { text: 'это нейросеть?', layer: 'feed', kind: 'line' },
  { text: 'посмотреть позже', layer: 'feed', kind: 'chip' },
  { text: 'в избранное', layer: 'feed', kind: 'chip' },
  { text: 'ссылка в шапке профиля', layer: 'feed', kind: 'line' },
  { text: 'алгоритм меня не любит', layer: 'feed', kind: 'line' },
  { text: 'тренд уже прошёл', layer: 'feed', kind: 'line' },
  { text: 'верните 2016', layer: 'feed', kind: 'line' },
  { text: 'кто все эти люди', layer: 'feed', kind: 'line' },
  { text: 'скролл', layer: 'feed', kind: 'line', echo: true, when: 'build' },
  { text: 'ещё одно видео и спать', layer: 'feed', kind: 'line' },

  // ---------------------------------------------------------------- search: typed, cut off
  { text: 'как купить квартиру если', layer: 'search', kind: 'search' }, // artist, edited
  { text: 'как выйти из', layer: 'search', kind: 'search' },
  { text: 'нормально ли что', layer: 'search', kind: 'search' },
  { text: 'почему все вокруг', layer: 'search', kind: 'search' },
  { text: 'сколько живут дрозофилы', layer: 'search', kind: 'search' },
  { text: 'что такое пресейв', layer: 'search', kind: 'search' },
  { text: 'как перестать думать о', layer: 'search', kind: 'search' },
  { text: 'как понять, что он', layer: 'search', kind: 'search' },
  { text: 'можно ли вернуть', layer: 'search', kind: 'search' },

  // ---------------------------------------------------------------- fly: its own absurd self
  { text: 'заебало в doom играть', layer: 'fly', kind: 'line' },     // artist
  { text: 'вот бы их самих оцифровать', layer: 'fly', kind: 'line' },// artist
  { text: 'интересно, тысячи мух могут ошибаться?', layer: 'fly', kind: 'line' }, // artist
  { text: 'на бирже было проще', layer: 'fly', kind: 'line', pict: 'candles' },
  { text: 'опять стекло', layer: 'fly', kind: 'line' },
  { text: 'стекло', layer: 'fly', kind: 'line', echo: true },
  { text: 'кто-то открыл вино', layer: 'fly', kind: 'line' },
  { text: 'пахнет бананом', layer: 'fly', kind: 'line' },
  { text: 'лететь на свет', layer: 'fly', kind: 'line' },
  { text: 'мне уже 23 дня', layer: 'fly', kind: 'line' },
  { text: 'ещё раз', layer: 'fly', kind: 'line', when: 'attempt' },
  { text: 'ещё чуть-чуть', layer: 'fly', kind: 'line', when: 'build' },
  { text: 'осталось {countdown}', layer: 'fly', kind: 'line' },      // {countdown} = S.countdownShort
  { text: 'вы действительно хоти', layer: 'under', kind: 'dialog', echo: true, when: 'build' },
];

// Fixed cues of the replay, in seconds of S.t (excerpt E). Each lands in the fore slot of the grid
// that contains it (scene.js MIND_ROWS); everything else is drawn from THOUGHTS.
export const CUES = [
  { t: 0.00, text: 'подключение…' },
  { t: 0.96, text: 'ищем спутники…' },
  { t: 13.68, text: 'пресе', kind: 'search', layer: 'search' },   // typed on the last eighth, cut by the last hit
];

// The line that lands on the last hit (13.92) and rings through the reverb tail. By S.replays.
export const DROP = [
  { text: 'что это за голоса у меня в голове?', layer: 'fly' },  // artist; the voices ring in the reverb
  { text: 'опять стекло', layer: 'under' },
  { text: 'вы действительно хотите выйти?', layer: 'under', kind: 'dialog' },
  { text: 'всё нормально)', layer: 'under', kind: 'bubble', out: true },
];

// Inside the head after SIGNAL LOST: one every two bars, slowly typed, in this order, then only a caret.
// They come from the last cell alive (the pink row 48 in the HUD raster), so they are pink too.
export const AFTER = [
  { text: 'печатает…', kind: 'bubble', special: 'typing' },
  { text: 'ок.', kind: 'bubble', out: true },
  { text: 'не моя остановка' },
  { text: 'интересно там?' },
];

// Inside the head after someone pressed presave for the fly.
export const PRESSED = [
  { text: 'ок)', kind: 'bubble', out: true },
  { text: 'добавлено в медиатеку', kind: 'notif' },
  { text: 'малиновый раф' },
  { text: '2 октября', kind: 'notif', pict: 'calendar' },
];
