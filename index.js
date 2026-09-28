/* roster-match —— 把听到的中文名字对到一份花名册上
 * Copyright (C) 2026  水滴匠
 *
 * 本程序是自由软件：你可以依据自由软件基金会发布的 GNU Affero 通用公共许可证
 * **第 3 版**的条款重新分发和/或修改它（AGPL-3.0-only，**不含**"或任何更新版本"）。
 *
 * 分发本程序是希望它有用，但**不提供任何担保**；甚至不包含适销性或特定用途适用性的
 * 默示担保。详见 GNU Affero 通用公共许可证。
 *
 * 你应当已随本程序收到一份许可证副本（见 LICENSE）。
 * 如果没有，见 <https://www.gnu.org/licenses/agpl-3.0.txt>。
 */

/* ============================================================
 * roster-match —— 给定「听到的几个字」和「一份名单」，
 * 告诉你最可能是谁、有多确定、为什么，以及**还有谁也说得通**。
 *
 * 它不做语音识别，不提取分数，不写数据库 —— 那些每家都不一样。
 *
 * 设计上最要紧的一条：**分数低的时候要老实说不确定**。
 * 匹配错一个人，代价是对方对着一条错记录发愣，而且多半发现不了；
 * 说「拿不准，你选一下」，代价只是多点一下。所以宁可多报不确定。
 *
 * ⚠️ `confident` 是**匹配启发式的自信程度，不是识别正确率**。
 *    它为真也不等于可以直接写库 —— 写进去之前请让人过一眼。
 * ============================================================ */

const DEFAULT_TABLE = require('./pinyin-table.js');

/* 常见多音姓：这些字单独看是一个音，放在姓的位置上是另一个音。
 * 只在**名字第一个字**上生效，而且只有两个字以上的名字才当姓看。 */
const SURNAME_READINGS = {
  单: 'shan', 曾: 'zeng', 区: 'ou', 仇: 'qiu', 解: 'xie', 查: 'zha', 朴: 'piao',
  乐: 'yue', 华: 'hua', 任: 'ren', 燕: 'yan', 翟: 'zhai', 盖: 'ge', 缪: 'miao',
  都: 'du', 折: 'she', 宁: 'ning', 过: 'guo', 种: 'chong', 秘: 'bi', 阚: 'kan',
  訾: 'zi', 冼: 'xian', 郗: 'xi', 员: 'yun', 覃: 'qin', 尉: 'yu', 牟: 'mou',
  长: 'zhang', 相: 'xiang', 召: 'shao', 繁: 'po', 应: 'ying', 车: 'che',
};

/* 口音归一化。**默认全开是给西南官话区用的**，别的方言区按需关掉 ——
 * 开得越多，误判越多。顺序要紧：先长后短（ing 必须在 in 前面）。 */
const ACCENT_RULES = {
  zcs:   s => s.replace(/^zh/, 'z').replace(/^ch/, 'c').replace(/^sh/, 's'),
  nl:    s => s.replace(/^n/, 'l'),
  nasal: s => s.replace(/ing$/, 'in').replace(/eng$/, 'en').replace(/ang$/, 'an'),
  hf:    s => s.replace(/^hu/, 'fu'),
};

/* 哪几层**够格标成 confident**。调分数改不了这个 ——
 * 「名单里只有一个姓李」这种猜测，哪怕给它 99 分也只是猜测。 */
const RELIABLE_KINDS = ['exact', 'samePinyin', 'oneLetter', 'surnameNear'];

/* 每一层的分数。**判定看命中哪一层（kind），不看分数** ——
 * 分数只影响排序和 accept 门槛，调高它不会把「读音接近」变成「姓名一模一样」。 */
const DEFAULT_SCORES = {
  exact: 100, samePinyin: 95, oneLetter: 85, surnameNear: 78,
  accent: 70, sameChars: 65, loneSurname: 62, nearPinyin: 55,
};

/* 汉字（含扩展区）。**不能用 /[一-龥]/** —— 那个漏掉扩展 B 以上的字，
 * 而姓名里恰恰有这类字，漏了就是"查不到也不报错"。 */
const HAN = /^[㐀-䶿一-鿿豈-﫿]$|^[\u{20000}-\u{3FFFF}]$/u;
const isHan = ch => HAN.test(ch);

/* ============================================================
 * 把一整段话按人切开
 * ------------------------------------------------------------
 * **支持**：名字后跟阿拉伯数字；人与人之间有标点、空格，或者直接连读。
 *   「杨凌90，李明88」「杨凌90+30李明80+20」「杨凌 90」
 * **不支持**（原样留在一段里，交给上层）：
 *   中文数字连读「李明九十分王红八十」、加减分描述「李明90分扣2分」。
 * 这是刻意的：中文数字和成绩规则属于业务，该由上层决定，
 * 不该在这里无限追加正则去猜。
 * ============================================================ */

/** 全角数字和全角空白归一成半角 */
function normalizeWidth(text) {
  return String(text)
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, ' ');
}

/** 停顿分隔符。空格只在**后面不是数字**时才算分隔 ——
 *  「李明 92」中间那个空格是名字和数字的间隔，不能切开。 */
const SEP = /[，,、。；;]+|\s+(?![\d.零〇一二两三四五六七八九十百点])/;

/** 给没有标点的连读补上分隔符：**数字后面紧跟汉字 = 换人**。 */
function splitRun(text) {
  /* 排除表里除了数字和加号，还有**加减分的说法**（加 扣 减 得 共 总）——
   * 「李明90分扣2分」里的「扣」不是下一个人的姓，切开会让上层以为有两个人。 */
  return normalizeWidth(text).replace(/(\d)\s*分?\s*(?=[^\d\s.+＋加扣减得共总点分，,、。；;])/g, '$1，');
}

/** 一整段话 → 一段一段（每段大致是一个人）。空段丢掉。
 *  连续空格不会把人和分数拆开（「李明  92」仍是一段）。 */
function splitSpeech(text) {
  return splitRun(text).replace(/[ \t]{2,}/g, ' ').split(SEP)
    .map(s => s.trim()).filter(Boolean);
}

class RosterMatch {
  /**
   * @param {object} [opt]
   * @param {object} [opt.table]     汉字→音节表，默认用内置的
   * @param {object} [opt.surnames]  多音姓读音覆盖，合并进内置表
   * @param {string[]} [opt.accent]  启用哪些口音规则，默认全开；传 [] 不做方言归一
   * @param {object} [opt.scores]    各层分数，可覆盖（只影响排序，不影响层级判定）
   * @param {number} [opt.accept]    分数高于它才算「敢认」，默认 78
   * @param {number} [opt.tie]       和第一名差距在这以内的都算并列候选，默认 8
   * @param {boolean} [opt.voice]    输入来自语音转写（默认 true）。
   *        语音只能选一种汉字写法，所以**同音的同学一律并列**，哪怕写法正好撞上一个。
   *        确定是键盘打的，设 false。
   */
  constructor(opt = {}) {
    this.table = opt.table || DEFAULT_TABLE;
    this.surnames = { ...SURNAME_READINGS, ...(opt.surnames || {}) };
    this.accent = opt.accent || Object.keys(ACCENT_RULES);
    this.scores = { ...DEFAULT_SCORES, ...(opt.scores || {}) };
    this.accept = opt.accept == null ? 78 : opt.accept;
    this.tie = opt.tie == null ? 8 : opt.tie;
    this.voice = opt.voice !== false;
    this.reliable = new Set(opt.reliable || RELIABLE_KINDS);
    this._c2p = null;
  }

  _build() {
    if (this._c2p) return;
    this._c2p = Object.create(null);
    for (const py in this.table)
      for (const ch of this.table[py])
        if (!(ch in this._c2p)) this._c2p[ch] = py;
  }

  /** 姓名 → **音节数组**（不是拼起来的字符串 —— 边界不能丢，见 samePinyin 那层）。
   *  查不到的字原样留着：它只会和自己相等，不会乱配。 */
  pinyin(name) {
    this._build();
    const chars = [...String(name)];
    return chars.map((c, i) =>
      (i === 0 && chars.length >= 2 && this.surnames[c]) || this._c2p[c] || c);
  }

  /**
   * 名字里哪些字**查不到读音**。查不到就匹配不上，而且不报错 ——
   * 这是这类工具最容易悄悄失效的地方。**上线前拿真实名单跑一遍**。
   * ⚠️ 返回空**不等于**这张表足够覆盖你的名单，只说明这几个字有读音。
   */
  unknownChars(name) {
    this._build();
    return [...String(name)].filter(c => isHan(c) && !(c in this._c2p));
  }

  /** 整份名单缺的字，去重。**请在本地跑** —— 别把真实名单贴进公开 issue。 */
  auditRoster(roster) {
    const bad = new Set();
    for (const s of roster || []) this.unknownChars((s && s.name) || '').forEach(c => bad.add(c));
    return [...bad];
  }

  _norm(syl) {
    let s = String(syl).toLowerCase();
    for (const k of this.accent) if (ACCENT_RULES[k]) s = ACCENT_RULES[k](s);
    return s;
  }

  key(name) { return this.pinyin(name).map(s => this._norm(s)); }

  /** 字符串编辑距离。差 3 个以上直接放弃。 */
  distance(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 2) return 99;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++)
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
                          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }

  /** 两串**音节**逐个比 → [几个音节不同, 这些不同一共差几个字母]。
   *  音节数不同直接判死：「王西安(wang xi an)」和「王先(wang xian)」
   *  拼起来都是 wangxian，**只有按音节比才分得开**。 */
  _sylDiff(a, b) {
    if (a.length !== b.length) return [99, 99];
    let n = 0, chars = 0;
    for (let i = 0; i < a.length; i++)
      if (a[i] !== b[i]) { n++; chars += this.distance(a[i], b[i]); }
    return [n, chars];
  }

  /** 名单得干净：每个人要有**唯一 id**。缺了或重了当场报错 ——
   *  不能悄悄按"同一个人"处理，那会把两个同名的人合成一个。 */
  _checkRoster(roster) {
    if (!Array.isArray(roster)) throw new TypeError('roster 要是数组');
    const seen = new Set();
    for (const s of roster) {
      if (!s || typeof s !== 'object') throw new TypeError('roster 里有空项');
      if (s.id === undefined || s.id === null || s.id === '')
        throw new TypeError(`roster 里有人没有 id：${JSON.stringify((s && s.name) || s)}`);
      const k = String(s.id);
      if (seen.has(k)) throw new TypeError(`roster 里 id 重复：${k}`);
      seen.add(k);
    }
  }

  /**
   * @param {string} spoken 听到的那几个字
   * @param {Array<{id:*,name:string}>} roster 名单（每人必须有唯一 id）
   * @returns {null | {student, score, kind, why, alts, ambiguous, confident}}
   *   kind       命中哪一层（exact/samePinyin/oneLetter/…）——**判定看它，不看分数**
   *   alts       其他说得过去的人
   *   ambiguous  还有别人也说得通，**别自动写入，让人选**
   *   confident  分数够高、层级可靠、且不 ambiguous。**不是识别正确率**
   */
  match(spoken, roster) {
    const said = String(spoken || '').trim();
    if (!said || !roster || !roster.length) return null;
    this._checkRoster(roster);

    const S = this.scores;
    const sSyl = this.pinyin(said), sKey = this.key(said);
    const sameSurname = roster.filter(x => x.name && x.name[0] === said[0]).length;

    const cand = roster.map(s => {
      const name = String(s.name || '');
      if (!name) return null;
      const nSyl = this.pinyin(name), nKey = this.key(name);
      const hit = (kind, why) => ({ s, kind, score: S[kind], why });

      if (name === said) return hit('exact', '姓名一模一样');
      if (nSyl.join('|') === sSyl.join('|')) return hit('samePinyin', '读音完全相同');

      const [dn, dc] = this._sylDiff(nSyl, sSyl);
      if (dn === 1 && dc === 1) return hit('oneLetter', '一个字的读音差一个字母');

      /* 同姓：姓对上了，名字部分再比。**按音节切，不是砍掉第一个字母** */
      if (name[0] === said[0]) {
        const [rn, rc] = this._sylDiff(nSyl.slice(1), sSyl.slice(1));
        if (rn <= 1 && rc <= 1) return hit('surnameNear', '同姓、名字读音接近');
      }

      if (nKey.join('|') === sKey.join('|')) return hit('accent', '口音归一后相同');

      /* 打字打错生僻字：读音怎么比都不像，靠字形兜。分数压低，只给人选 */
      if (said.length >= 3 && name.length === said.length &&
          [...said].filter((c, i) => name[i] === c).length >= said.length - 1)
        return hit('sameChars', '有两个字一样');

      if (dn <= 2 && dc <= 2) return hit('nearPinyin', '读音接近');

      if (name[0] === said[0] && sameSurname === 1)
        return hit('loneSurname', '名单里只有一个姓' + said[0]);

      return null;
    }).filter(Boolean).sort((a, b) => b.score - a.score);

    if (!cand.length) return null;
    const best = cand[0];
    const sJoin = sSyl.join('|');

    /* 并列候选 = 两拨人的并集，**两拨都要查**：
     *   (a) 分数咬得紧的；
     *   (b) 跟老师说的那几个字**同名或同音**的 —— 语音只能挑一种汉字写法，
     *       写法撞上谁纯属巧合，不能因为第一名不是 exact 就跳过这项检查。
     *       （调分数把 samePinyin 顶到 exact 之上时，漏的就是这一项。） */
    /* 写法一模一样的，分数上的并列就不算了 —— 它比别人强；
     * 真正还要查的是同名/同音（下面那行）。 */
    const close = best.kind === 'exact' ? []
      : cand.filter(c => c.s.id !== best.s.id && c.score >= best.score - this.tie);
    const homo  = cand.filter(c => c.s.id !== best.s.id &&
      (c.s.name === said || (this.voice && this.pinyin(c.s.name).join('|') === sJoin)));

    const seen = new Set([String(best.s.id)]);
    const alts = [];
    for (const c of [...close, ...homo]) {
      const k = String(c.s.id);
      if (!seen.has(k)) { seen.add(k); alts.push(c.s); }
    }

    const why = homo.length
      ? (homo.some(r => r.s.name === said) ? '名单里有同名的' : '名单里有同音的，语音分不出写法')
      : best.why;
    return this._wrap(best, alts, why);
  }

  _wrap(best, alts, why) {
    const ambiguous = alts.length > 0;
    return {
      student: best.s, score: best.score, kind: best.kind, why, alts, ambiguous,
      /* 三个条件都要满足：层级够格、分数够高、没有并列 */
      confident: this.reliable.has(best.kind) && best.score >= this.accept && !ambiguous,
    };
  }
}

module.exports = { RosterMatch, splitSpeech, splitRun, normalizeWidth, SEP,
                   SURNAME_READINGS, ACCENT_RULES, DEFAULT_SCORES, RELIABLE_KINDS,
                   PINYIN_TABLE: DEFAULT_TABLE };
