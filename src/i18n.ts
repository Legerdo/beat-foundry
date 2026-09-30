// All player-facing text, in English and Korean. `t(key, vars)` fills {placeholders}.
import type { LayerId, MetaId, ModId } from './game/types';

export type Lang = 'en' | 'ko';

let lang: Lang = 'en';

export function setLang(l: Lang): void {
  lang = l;
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}

export function getLang(): Lang {
  return lang;
}

export function detectLang(): Lang {
  const langs = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  return langs.some((l) => l?.toLowerCase().startsWith('ko')) ? 'ko' : 'en';
}

const EN = {
  // title
  'title.kicker': 'A RHYTHM FOUNDRY',
  'title.lede': 'Every note you forge plays, and every note that plays earns.<br />Start with a heartbeat. End with a record.',
  'title.start': 'LIGHT THE FURNACE',
  'title.continue': 'RETURN TO THE FURNACE',
  'title.continueLine': 'Continue · Track {n} — {name} · {r}/3 records cast',
  'title.foot': 'Headphones recommended · strike with SPACE or a click',
  // top + hud
  'top.mute': 'Mute',
  'top.unmute': 'Unmute',
  'top.settings': 'Settings',
  'top.lang': '한국어',
  'track.meta': 'TRACK {n} · {bpm} BPM · {key}',
  'rate': '✦ {v} / s',
  'keys': '<kbd>SPACE</kbd> strike <kbd>ENTER</kbd> pour <kbd>1–8</kbd> forge <kbd>Q W E</kbd> mods <kbd>ESC</kbd> settings',
  'goal.layer': 'NEXT LAYER <b style="color:{color}">{name}</b> ✦ {cost}',
  'goal.cast': 'GOAL <b>CAST THE RECORD</b> ✦ {cost}',
  'goal.casting': 'CASTING THE RECORD',
  'pour': 'POUR <kbd>ENTER</kbd>',
  'pour.queued': 'POURING <small>NEXT BAR</small>',
  // bench
  'bench.title': 'WORKBENCH',
  'bench.more': 'More layers wait behind the next one',
  'bench.mods': 'MODS',
  'forge': 'FORGE',
  'unlock': 'UNLOCK',
  'forged': 'FORGED',
  'aria.forged': '{name} is fully forged',
  'aria.unlock': 'Unlock {name} for {cost} sparks',
  'aria.forge': 'Forge a note on {name} for {cost} sparks',
  'aria.mod': 'Buy {name} for {cost} sparks',
  'mod.owned': 'OWNED',
  'mods.next': 'Next mod unlocks at {req}',
  'need.layer': '{layer} ×{n}',
  'need.drops': '{n} DROPS',
  'need.flares': '{n} FLARES',
  'cast.title': 'CAST THE RECORD',
  'cast.text': 'Pour the whole machine into one master drop and press it into a record. Ends the track, keeps the record forever.',
  'cast.btn': 'CAST ✦ {cost}',
  'cast.confirm': 'CLICK AGAIN TO CAST · ENDS THE TRACK',
  'cast.casting': 'CASTING…',
  'cast.aria': 'Cast the record for {cost} sparks. This ends the track.',
  'apprentice': 'Apprentice forges the cheapest note',
  // sections
  'sec.build': 'BUILD · STRIKE THE MARKERS',
  'sec.castbuild': 'MASTER BUILD · STRIKE THE MARKERS',
  'sec.drop': 'DROP · {n} BARS LEFT',
  'sec.drop1': 'DROP · LAST BAR',
  'sec.finale': 'MASTER POUR ×{m}',
  'sec.break': 'COOLING',
  'sec.outro': 'THE RECORD IS CAST',
  'sec.groove': 'GROOVE {n}',
  // banners
  'b.newLayer': 'NEW LAYER · {name}',
  'b.forged': '{name} FORGED',
  'b.forgedSub': 'The full pattern plays. This layer now earns ×2.',
  'b.pour': 'THE POUR BEGINS',
  'b.pourSub': 'Strike the markers on the rim to charge the drop',
  'b.drop': 'DROP ×{m}',
  'b.perfectCharge': 'PERFECT CHARGE',
  'b.charge': 'CHARGE {p}%',
  'b.master': 'MASTER POUR',
  'b.masterSub': '×{m} — everything you forged, at once',
  'b.casting': 'CASTING THE RECORD',
  'b.castingSub': 'Four bars to charge the master pour',
  'b.flare': 'FLARE CAUGHT',
  'b.flareSub': '+{v} sparks and a rush of heat',
  'toast.offline': 'The foundry kept playing for {time}: +{v} ✦',
  'toast.reset': 'Progress reset. The furnace starts cold.',
  'toast.tutorial': 'The tutorial will guide you again.',
  'hit.perfect': 'PERFECT',
  'hit.good': 'GOOD',
  'hit.miss': 'MISS',
  // canvas
  'c.charge': 'CHARGE',
  'c.pour': 'POUR',
  'c.nextBar': 'NEXT BAR',
  'c.enter': 'ENTER',
  'c.heat': 'HEAT',
  'c.strike': 'SPACE',
  'c.tap': 'TAP',
  'c.now': 'NOW',
  'c.record': 'BEAT FOUNDRY · TRACK {n}',
  // tutorial coach
  'coach.label': 'TUTORIAL',
  'coach.skip': 'SKIP',
  'coach.strike.t': 'STRIKE ON THE BEAT',
  'coach.strike.b': 'Press SPACE (or click the machine) the moment the shrinking ring meets the crucible.',
  'coach.forge.t': 'FORGE A NOTE',
  'coach.forge.b': 'Spend sparks on the glowing button (or press {key}). Every note you add plays and earns.',
  'coach.lit.t': 'THE CRUCIBLE IS LIT',
  'coach.lit.b': 'Kicks and on-beat strikes heat it. At 100 you can pour a drop.',
  'coach.pour.t': 'POUR',
  'coach.pour.b': 'The crucible is full. Press ENTER or click POUR to start a build-up.',
  'coach.charge.t': 'CHARGE THE DROP',
  'coach.charge.b': 'Strike each white marker as the ring closes on it. More hits, bigger drop.',
  'coach.flare.t': 'FLARE',
  'coach.flare.b': 'Strike the moment the beam crosses the golden note for a burst of sparks.',
  'coach.mod.t': 'MODS',
  'coach.mod.b': 'Mods change how the music sounds and earns. Q, W and E buy the first three.',
  'coach.cast.t': 'CAST THE RECORD',
  'coach.cast.b': 'Every layer is live. Save up and cast to finish the track. Records boost all future sparks.',
  // settings
  'set.title': 'SETTINGS',
  'set.paused': 'Paused · music and production resume when you close settings.',
  'set.language': 'Language',
  'set.master': 'Master volume',
  'set.music': 'Music',
  'set.sfx': 'Effects & strikes',
  'set.shake': 'Screen shake',
  'set.flash': 'Flashes',
  'set.quality': 'Graphics',
  'set.quality.auto': 'Auto',
  'set.quality.high': 'High',
  'set.quality.low': 'Low',
  'set.reduced': 'Reduced motion (no camera punches, fewer particles)',
  'set.guide': 'Beat guide (approach ring)',
  'set.hints': 'Show tutorial',
  'set.replay': 'REPLAY TUTORIAL',
  'set.offset': 'Input offset',
  'set.offsetNote': 'Adjust when sound and input feel out of sync. Positive values compensate late input; negative values compensate early input.',
  'set.keys': 'SPACE / F / J / click — strike · ENTER — pour · 1–8 — forge · Q W E — mods · M — mute · ESC — settings',
  'set.reset': 'RESET PROGRESS',
  'set.resetArm': 'CLICK AGAIN TO ERASE EVERYTHING',
  'set.back': 'BACK TO THE FOUNDRY',
  'debug.title': 'DEBUG / CHEATS',
  'debug.note': 'Paused. These actions change your saved progress. Start a track first; cheats are disabled while casting.',
  'debug.status': 'Sparks {sparks} ✦ · Gold {gold} · Heat {heat}',
  'debug.sparksSmall': '+1M SPARKS',
  'debug.sparksLarge': '+1B SPARKS',
  'debug.castBudget': 'FILL CASTING BUDGET',
  'debug.heat': 'FILL HEAT TO 100',
  'debug.forge': 'FORGE ALL CURRENT LAYERS',
  'debug.mods': 'UNLOCK ALL CURRENT MODS',
  'debug.gold': '+10 GOLD',
  'debug.back': 'BACK TO SETTINGS',
  // credits
  'cr.kicker': 'FINALE',
  'cr.title': 'THE FOUNDRY SINGS',
  'cr.lede': 'One heartbeat became three records and a machine that plays itself. Thank you for forging it.',
  'cr.time': 'time in the foundry',
  'cr.sparks': 'sparks forged',
  'cr.drops': 'drops poured',
  'cr.best': 'biggest drop',
  'cr.perfects': 'perfect strikes',
  'cr.flares': 'flares caught',
  'cr.after': 'The foundry stays open. Re-forge any track for more gold and finish every upgrade.',
  'cr.go': 'ENTER THE FOUNDRY ▸',
  // foundry
  'fd.first': 'RECORD CAST',
  'fd.encore': 'ENCORE CAST',
  'fd.gold': '<b>+{g}</b> GOLD <span class="gold-total">· {total} in the vault</span>',
  'fd.mult': 'Every record cast multiplies all sparks ×{m} — forever. Now ×{now}.',
  'fd.upgrades': 'FOUNDRY UPGRADES · PERMANENT',
  'fd.owned': 'OWNED',
  'fd.cost': '{c} GOLD',
  'fd.aria': 'Buy {name} for {c} gold',
  'fd.reforge': 'RE-FORGE {name} ▸',
  'fd.next': 'FORGE TRACK {n} — {name} ▸',
  // time
  't.h': '{h}h {m}m',
  't.m': '{m}m {s}s',
  't.s': '{s}s',
};

type Key = keyof typeof EN;

const KO: Record<Key, string> = {
  'title.kicker': '리듬 파운드리',
  'title.lede': '단조한 음표는 모두 연주되고, 연주되는 음표는 모두 스파크를 법니다.<br />심장 박동 하나로 시작해, 한 장의 레코드로 끝납니다.',
  'title.start': '용광로 점화',
  'title.continue': '용광로로 돌아가기',
  'title.continueLine': '이어하기 · 트랙 {n} — {name} · 레코드 {r}/3',
  'title.foot': '헤드폰 권장 · SPACE 또는 클릭으로 타격',
  'top.mute': '음소거',
  'top.unmute': '음소거 해제',
  'top.settings': '설정',
  'top.lang': 'English',
  'track.meta': '트랙 {n} · {bpm} BPM · {key}',
  'rate': '✦ 초당 {v}',
  'keys': '<kbd>SPACE</kbd> 타격 <kbd>ENTER</kbd> 붓기 <kbd>1–8</kbd> 단조 <kbd>Q W E</kbd> 모드 <kbd>ESC</kbd> 설정',
  'goal.layer': '다음 레이어 <b style="color:{color}">{name}</b> ✦ {cost}',
  'goal.cast': '목표 <b>레코드 굽기</b> ✦ {cost}',
  'goal.casting': '레코드를 굽는 중',
  'pour': '붓기 <kbd>ENTER</kbd>',
  'pour.queued': '붓는 중 <small>다음 마디</small>',
  'bench.title': '작업대',
  'bench.more': '다음 레이어를 열면 새 레이어가 나타납니다',
  'bench.mods': '모드',
  'forge': '단조',
  'unlock': '해금',
  'forged': '완성',
  'aria.forged': '{name} 레이어가 완성되었습니다',
  'aria.unlock': '스파크 {cost}로 {name} 해금',
  'aria.forge': '스파크 {cost}로 {name} 음표 단조',
  'aria.mod': '스파크 {cost}로 {name} 구매',
  'mod.owned': '보유',
  'mods.next': '다음 모드 조건: {req}',
  'need.layer': '{layer} ×{n}',
  'need.drops': '드롭 {n}회',
  'need.flares': '플레어 {n}회',
  'cast.title': '레코드 굽기',
  'cast.text': '기계 전체를 하나의 마스터 드롭에 쏟아 레코드로 찍어냅니다. 트랙이 끝나고, 레코드는 영원히 남습니다.',
  'cast.btn': '굽기 ✦ {cost}',
  'cast.confirm': '한 번 더 눌러 굽기 · 트랙이 끝납니다',
  'cast.casting': '굽는 중…',
  'cast.aria': '스파크 {cost}로 레코드를 굽습니다. 트랙이 끝납니다.',
  'apprentice': '견습생이 가장 싼 음표를 단조',
  'sec.build': '빌드업 · 마커를 치세요',
  'sec.castbuild': '마스터 빌드업 · 마커를 치세요',
  'sec.drop': '드롭 · {n}마디 남음',
  'sec.drop1': '드롭 · 마지막 마디',
  'sec.finale': '마스터 붓기 ×{m}',
  'sec.break': '냉각',
  'sec.outro': '레코드 완성',
  'sec.groove': '그루브 {n}',
  'b.newLayer': '새 레이어 · {name}',
  'b.forged': '{name} 완성',
  'b.forgedSub': '전체 패턴이 연주됩니다. 이 레이어의 수익이 2배가 됩니다.',
  'b.pour': '붓기 시작',
  'b.pourSub': '테두리의 마커를 쳐서 드롭을 충전하세요',
  'b.drop': '드롭 ×{m}',
  'b.perfectCharge': '완벽한 충전',
  'b.charge': '충전 {p}%',
  'b.master': '마스터 붓기',
  'b.masterSub': '×{m} — 단조한 모든 것이 한꺼번에',
  'b.casting': '레코드를 굽습니다',
  'b.castingSub': '4마디 동안 마스터 붓기를 충전하세요',
  'b.flare': '플레어 포착',
  'b.flareSub': '스파크 +{v}, 열이 확 오릅니다',
  'toast.offline': '자리를 비운 {time} 동안 파운드리가 연주했습니다: +{v} ✦',
  'toast.reset': '진행이 초기화되었습니다. 용광로가 식었습니다.',
  'toast.tutorial': '튜토리얼이 다시 안내합니다.',
  'hit.perfect': '퍼펙트',
  'hit.good': '굿',
  'hit.miss': '미스',
  'c.charge': '충전',
  'c.pour': '붓기',
  'c.nextBar': '다음 마디',
  'c.enter': 'ENTER',
  'c.heat': '열',
  'c.strike': 'SPACE',
  'c.tap': '탭',
  'c.now': '지금',
  'c.record': 'BEAT FOUNDRY · 트랙 {n}',
  'coach.label': '튜토리얼',
  'coach.skip': '건너뛰기',
  'coach.strike.t': '박자에 맞춰 치기',
  'coach.strike.b': '줄어드는 링이 용광로 테두리에 닿는 순간 SPACE를 누르세요 (기계를 클릭해도 됩니다).',
  'coach.forge.t': '음표 단조',
  'coach.forge.b': '빛나는 버튼으로 스파크를 쓰세요 (단축키 {key}). 추가한 음표는 연주되며 스파크를 법니다.',
  'coach.lit.t': '용광로 점화',
  'coach.lit.b': '킥과 정박 타격이 열을 올립니다. 100이 되면 드롭을 부을 수 있습니다.',
  'coach.pour.t': '붓기',
  'coach.pour.b': '용광로가 가득 찼습니다. ENTER 또는 붓기 버튼으로 빌드업을 시작하세요.',
  'coach.charge.t': '드롭 충전',
  'coach.charge.b': '링이 흰 마커에 닫힐 때마다 치세요. 많이 맞힐수록 드롭이 커집니다.',
  'coach.flare.t': '플레어',
  'coach.flare.b': '빔이 금색 음표를 지나는 순간 치면 스파크가 쏟아집니다.',
  'coach.mod.t': '모드',
  'coach.mod.b': '모드는 음악의 소리와 버는 방식을 바꿉니다. Q, W, E로 위의 세 개를 살 수 있습니다.',
  'coach.cast.t': '레코드 굽기',
  'coach.cast.b': '모든 레이어가 살아났습니다. 모아서 레코드를 구우면 트랙이 끝나고, 레코드가 이후의 모든 스파크를 늘려 줍니다.',
  'set.title': '설정',
  'set.paused': '일시정지 중 · 설정을 닫으면 음악과 생산이 이어집니다.',
  'set.language': '언어',
  'set.master': '전체 음량',
  'set.music': '음악',
  'set.sfx': '효과음·타격',
  'set.shake': '화면 흔들림',
  'set.flash': '번쩍임',
  'set.quality': '그래픽',
  'set.quality.auto': '자동',
  'set.quality.high': '높음',
  'set.quality.low': '낮음',
  'set.reduced': '모션 줄이기 (카메라 충격 없음, 파티클 감소)',
  'set.guide': '박자 가이드 (접근 링)',
  'set.hints': '튜토리얼 표시',
  'set.replay': '튜토리얼 다시 보기',
  'set.offset': '입력 보정',
  'set.offsetNote': '소리와 타격 타이밍이 어긋나면 보정하세요. 양수는 늦게 잡히는 입력, 음수는 일찍 잡히는 입력을 보정합니다.',
  'set.keys': 'SPACE / F / J / 클릭 — 타격 · ENTER — 붓기 · 1–8 — 단조 · Q W E — 모드 · M — 음소거 · ESC — 설정',
  'set.reset': '진행 초기화',
  'set.resetArm': '한 번 더 누르면 모두 지워집니다',
  'set.back': '파운드리로 돌아가기',
  'debug.title': '디버그 / 치트',
  'debug.note': '일시정지 중입니다. 사용 결과는 진행 저장에 반영됩니다. 트랙 시작 후 사용할 수 있으며, 레코드를 굽는 동안에는 비활성화됩니다.',
  'debug.status': '스파크 {sparks} ✦ · 골드 {gold} · 열 {heat}',
  'debug.sparksSmall': '스파크 +1M',
  'debug.sparksLarge': '스파크 +1B',
  'debug.castBudget': '레코드 굽기 자금 채우기',
  'debug.heat': '열 100 채우기',
  'debug.forge': '현재 레이어 모두 단조',
  'debug.mods': '현재 트랙 모드 모두 해금',
  'debug.gold': '골드 +10',
  'debug.back': '설정으로 돌아가기',
  'cr.kicker': '피날레',
  'cr.title': '파운드리가 노래합니다',
  'cr.lede': '심장 박동 하나가 세 장의 레코드와 스스로 연주하는 기계가 되었습니다. 함께 단조해 주셔서 고맙습니다.',
  'cr.time': '파운드리에서 보낸 시간',
  'cr.sparks': '단조한 스파크',
  'cr.drops': '부은 드롭',
  'cr.best': '가장 큰 드롭',
  'cr.perfects': '퍼펙트 타격',
  'cr.flares': '잡은 플레어',
  'cr.after': '파운드리는 계속 열려 있습니다. 아무 트랙이나 다시 단조해 골드를 모으고 업그레이드를 모두 채워 보세요.',
  'cr.go': '파운드리로 ▸',
  'fd.first': '레코드 완성',
  'fd.encore': '앙코르 완성',
  'fd.gold': '<b>+{g}</b> 골드 <span class="gold-total">· 금고에 {total}</span>',
  'fd.mult': '구운 레코드마다 모든 스파크가 영원히 ×{m}. 지금 ×{now}.',
  'fd.upgrades': '파운드리 업그레이드 · 영구',
  'fd.owned': '보유',
  'fd.cost': '{c} 골드',
  'fd.aria': '{c} 골드로 {name} 구매',
  'fd.reforge': '{name} 다시 단조 ▸',
  'fd.next': '트랙 {n} 단조 — {name} ▸',
  't.h': '{h}시간 {m}분',
  't.m': '{m}분 {s}초',
  't.s': '{s}초',
};

const DICT: Record<Lang, Record<Key, string>> = { en: EN, ko: KO };

/** For tests: both dictionaries. */
export const DICTIONARIES = DICT;

export function t(key: Key, vars?: Record<string, string | number>): string {
  const s = DICT[lang][key] ?? EN[key] ?? key;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

// ------------------------------------------------------------------ game content

interface LayerText {
  name: string;
  role: string;
  text: string;
}

const LAYER_TEXT: Record<Lang, Record<LayerId, LayerText>> = {
  en: {
    kick: { name: 'KICK', role: 'DRIVE', text: 'Every kick feeds the crucible with heat.' },
    hat: { name: 'HAT', role: 'SHIMMER', text: '+3% to all sparks per hat note.' },
    clap: { name: 'CLAP', role: 'BACKBEAT', text: 'Lights the crucible. +25% strike power per clap.' },
    bass: { name: 'BASS', role: 'WEIGHT', text: 'Locks to the kick: +15% per kick note.' },
    chord: { name: 'CHORD', role: 'HARMONY', text: '+20% to bass and lead per chord note.' },
    lead: { name: 'LEAD', role: 'HOOK', text: 'Flares favor the hook and pay double.' },
    bells: { name: 'BELLS', role: 'RESONANCE', text: '+0.25 drop power per bell note.' },
    choir: { name: 'CHOIR', role: 'CHORUS', text: 'All sparks ×1.3 per choir voice.' },
  },
  ko: {
    kick: { name: '킥', role: '추진', text: '킥 하나하나가 용광로에 열을 더합니다.' },
    hat: { name: '하이햇', role: '반짝임', text: '하이햇 음표마다 모든 스파크 +3%.' },
    clap: { name: '클랩', role: '백비트', text: '용광로에 불을 붙입니다. 클랩마다 타격 위력 +25%.' },
    bass: { name: '베이스', role: '무게', text: '킥과 맞물립니다: 킥 음표마다 +15%.' },
    chord: { name: '코드', role: '화성', text: '코드 음표마다 베이스와 리드 +20%.' },
    lead: { name: '리드', role: '훅', text: '플레어가 훅에 더 자주 뜨고 2배를 줍니다.' },
    bells: { name: '벨', role: '공명', text: '벨 음표마다 드롭 위력 +0.25.' },
    choir: { name: '합창', role: '코러스', text: '합창 목소리마다 모든 스파크 ×1.3.' },
  },
};

const MOD_TEXT: Record<Lang, Record<ModId, [string, string]>> = {
  en: {
    openhat: ['OPEN HATS', 'Offbeat hats ring open. Hats ×3, shimmer doubled.'],
    echo: ['ECHO CHAMBER', 'Claps and lead throw dotted-eighth echoes. Every echo earns half.'],
    sidechain: ['SIDECHAIN PUMP', 'Bass and chords breathe with the kick. Kick bond doubled, chords join it.'],
    autopour: ['AUTO-POUR', 'The crucible pours itself when full. Your charge still lifts it.'],
    catcher: ['FLARE CATCHER', 'Flares you miss are caught at half value.'],
    cathedral: ['CATHEDRAL', 'A vast hall of reverb. Heat builds 40% faster.'],
    subdrop: ['SUB PRESSURE', 'Drops sit on a sub-bass floor. Drop power +1.'],
    supersaw: ['SUPERSAW WALL', 'Drops unleash a detuned saw wall. Drop power +1.5.'],
    octave: ['OCTAVE SPLIT', 'The hook doubles an octave up. Lead ×2.'],
    tape: ['TAPE SATURATION', 'Warm analog drive on the master. All sparks ×1.5.'],
    swing: ['SWING', 'Shuffle the grid. Hats ×2, timing windows a touch wider.'],
    cascade: ['BELL CASCADE', 'Bells ring in cascades. Resonance doubled, bells ×2.'],
    keychange: ['KEY CHANGE', 'Every drop lifts a whole step. Drop power +2.'],
  },
  ko: {
    openhat: ['오픈 하이햇', '오프비트 하이햇이 열린 소리로 울립니다. 하이햇 ×3, 반짝임 2배.'],
    echo: ['에코 챔버', '클랩과 리드가 점8분 에코를 던집니다. 에코마다 절반을 벌어요.'],
    sidechain: ['사이드체인 펌프', '베이스와 코드가 킥에 맞춰 숨 쉽니다. 킥 결합 2배, 코드도 합류.'],
    autopour: ['자동 붓기', '용광로가 가득 차면 스스로 붓습니다. 직접 충전하면 더 강해집니다.'],
    catcher: ['플레어 포수', '놓친 플레어를 절반 가치로 잡아 줍니다.'],
    cathedral: ['대성당', '거대한 잔향의 홀. 열이 40% 더 빨리 오릅니다.'],
    subdrop: ['서브 프레셔', '드롭이 서브 베이스 위에 섭니다. 드롭 위력 +1.'],
    supersaw: ['슈퍼소 월', '드롭에서 디튠된 톱니파 벽이 터집니다. 드롭 위력 +1.5.'],
    octave: ['옥타브 분할', '훅이 한 옥타브 위로 겹칩니다. 리드 ×2.'],
    tape: ['테이프 새추레이션', '마스터에 따뜻한 아날로그 드라이브. 모든 스파크 ×1.5.'],
    swing: ['스윙', '그리드를 셔플합니다. 하이햇 ×2, 판정 범위가 조금 넓어집니다.'],
    cascade: ['벨 캐스케이드', '벨이 연쇄로 울립니다. 공명 2배, 벨 ×2.'],
    keychange: ['전조', '드롭마다 온음 올라갑니다. 드롭 위력 +2.'],
  },
};

const META_TEXT: Record<Lang, Record<MetaId, [string, string]>> = {
  en: {
    warm: ['WARM START', 'Begin each track with 4 kicks, 4 hats, a clap and the crucible lit.'],
    overtone: ['OVERTONES', 'All sparks ×2 per level.'],
    bellows: ['BELLOWS', 'Heat builds 50% faster per level.'],
    anvil: ['TUNED ANVIL', 'Strikes earn ×2 and timing windows widen 20%.'],
    apprentice: ['APPRENTICE', 'Forges the cheapest note for you whenever you can afford it.'],
    crucible: ['DEEP CRUCIBLE', 'Drop power +2 per level.'],
    longpour: ['LONG POUR', 'Drops last 4 bars longer.'],
    lens: ['FLARE LENS', 'Flares come twice as often and are auto-caught at 60%.'],
  },
  ko: {
    warm: ['따뜻한 시작', '킥 4, 하이햇 4, 클랩 1과 점화된 용광로로 트랙을 시작합니다.'],
    overtone: ['배음', '레벨마다 모든 스파크 ×2.'],
    bellows: ['풀무', '레벨마다 열이 50% 더 빨리 오릅니다.'],
    anvil: ['조율된 모루', '타격 수익 ×2, 판정 범위 20% 확대.'],
    apprentice: ['견습생', '살 수 있을 때마다 가장 싼 음표를 대신 단조합니다.'],
    crucible: ['깊은 도가니', '레벨마다 드롭 위력 +2.'],
    longpour: ['긴 붓기', '드롭이 4마디 더 길어집니다.'],
    lens: ['플레어 렌즈', '플레어가 두 배 자주 뜨고, 60% 가치로 자동으로 잡힙니다.'],
  },
};

const KEY_NAMES: Record<Lang, string[]> = {
  en: ['A MINOR', 'D MINOR', 'E MINOR'],
  ko: ['A 단조', 'D 단조', 'E 단조'],
};

export const layerText = (id: LayerId): LayerText => LAYER_TEXT[lang][id];
export const modName = (id: ModId): string => MOD_TEXT[lang][id][0];
export const modText = (id: ModId): string => MOD_TEXT[lang][id][1];
export const metaName = (id: MetaId): string => META_TEXT[lang][id][0];
export const metaText = (id: MetaId): string => META_TEXT[lang][id][1];
export const keyName = (track: number): string => KEY_NAMES[lang][track];
export const ROMAN = ['I', 'II', 'III'];

export function fmtTimeL(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? t('t.h', { h, m }) : m > 0 ? t('t.m', { m, s: r }) : t('t.s', { s: r });
}

/** Font stack with Hangul fallbacks, shared by CSS and canvas. */
export const FONT_STACK =
  "'Bahnschrift', 'DIN Alternate', 'Roboto Condensed', 'Segoe UI', 'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', 'Noto Sans KR', system-ui, sans-serif";
