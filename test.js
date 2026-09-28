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
/* 跑：node test.js
 *
 * ⚠️ 这里面**一个真实学生的名字都没有**，全是编的。
 *    这类项目最容易出的事故就是把测试用例当成真名单提交上去。
 */
const assert = require('assert/strict');
const { RosterMatch, splitSpeech } = require('./index.js');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.equal(a, b, m); n++; };

const M = new RosterMatch();

/* 一份编出来的名单，故意塞了几种难办的情况：
 *   杨凌 / 杨林   —— 只差一个字母（ling / lin）
 *   李明 / 李鸣   —— 真同音字
 *   张伟 / 张薇   —— 读音相同，但名字写法不同
 *   欧阳宇   —— 复姓
 *   顾言七   —— 名字里带数字字
 */
const roster = [
  { id: 1, name: '杨凌' }, { id: 2, name: '李明' }, { id: 3, name: '张伟' },
  { id: 4, name: '王小刚' }, { id: 5, name: '欧阳宇' }, { id: 6, name: '顾言七' },
  { id: 7, name: '陈思远' }, { id: 8, name: '何知远' },
];

/* ---------- 逐层验证 ---------- */
{
  const r = M.match('李明', roster);
  eq(r.student.id, 2, '一模一样');
  eq(r.score, 100, '满分');
  ok(r.confident, '一模一样必须是确定的');
}
{
  const r = M.match('李鸣', roster);          // 同音不同字
  eq(r.student.id, 2, '拼音完全相同');
  ok(r.score >= 95, '同音字分数要高');
}
{
  const r = M.match('杨林', roster);          // lin vs ling
  eq(r.student.id, 1, '差一个字母');
  ok(r.score >= 85, '差一个字母还是敢认');
  ok(r.confident, '这类最常见，要敢认，不然老师每条都得点');
}
{
  const r = M.match('张薇', roster);          // 和张伟同音
  eq(r.student.id, 3, '同音字落到张伟头上');
}
{
  const r = M.match('欧阳羽', roster);
  eq(r.student.id, 5, '复姓也要能对上');
}

/* ---------- 不确定的时候要老实说 ---------- */
{
  /* 语音只能挑一种汉字写法，写法正好撞上不等于说的就是这个人 ——
   * 所以默认（voice）把同音的也摆出来让人选。 */
  const two = [{ id: 1, name: '李明' }, { id: 2, name: '李鸣' }];
  const r = M.match('李明', two);
  eq(r.student.id, 1, '写法一样的排第一');
  eq(r.kind, 'exact', '层级是 exact');
  ok(r.ambiguous && r.alts.some(a => a.id === 2), '语音模式下同音的要并列出来');
  ok(!r.confident, '有同音的就不能自动写入');

  const typed = new RosterMatch({ voice: false }).match('李明', two);
  ok(typed.confident && !typed.ambiguous, '确定是键盘打的（voice:false）才算确定');
}
{
  const two = [{ id: 1, name: '李明' }, { id: 2, name: '李鸣' }];
  const r = M.match('李名', two);              // 两个都不完全一样，读音都对
  ok(r.ambiguous, '两个都说得通时必须标成拿不准');
  ok(!r.confident, '拿不准就不能自动写入');
  ok(r.alts.length >= 1, '要把另一个候选给出来');
}
{
  const dup = [{ id: 1, name: '李明' }, { id: 2, name: '李明' }];
  const r = M.match('李明', dup);
  ok(r.ambiguous, '名单里真有两个同名的，要让人选');
  eq(r.why, '名单里有同名的', '理由要说清楚');
}
{
  eq(M.match('不存在的人', roster), null, '完全对不上要返回 null，不能硬塞');
  eq(M.match('', roster), null, '空字符串');
  eq(M.match('李明', []), null, '空名单');
}

/* ---------- 打字打错生僻字：读音完全不像，靠字形兜 ---------- */
{
  /* 注意：「园」和「远」不带声调时拼音是一样的，拿它当例子会走「同音」那一层。
   * 要试字形兜底，得挑一个读音差得远的字。 */
  const r = M.match('陈思达', roster);
  eq(r.student.id, 7, '三个字里两个一样');
  ok(!r.confident, '这种只能当候选，不能自动认');
}

/* ---------- 口音规则可关 ---------- */
{
  const plain = new RosterMatch({ accent: [] });
  const full = new RosterMatch();
  /* key() 返回的是**音节数组**（边界不能丢），比的时候拼一下 */
  eq(full.key('张').join('|'), 'zan', '全开：zhang → 平翘舌 z + 前后鼻音 an');
  eq(plain.key('张').join('|'), 'zhang', '全关：原样');

  /* 「章林」对「张宁」：原始拼音差两个字母（只能算「读音接近」），
   * 口音归一之后才完全相同。用它区分开与不开。 */
  const list = [{ id: 1, name: '张宁' }];
  ok(full.match('章林', list).score >= 70, '开了规则：口音归一后相同');
  ok(plain.match('章林', list).score < 70, '关了规则：只能算读音接近，分数更低');
}

/* ---------- 名字里带数字字，别被当成别的 ---------- */
{
  const r = M.match('顾言七', roster);
  eq(r.student.id, 6, '名字里带「七」也要原样对上');
}

/* ---------- 查不到读音的字：必须查得出来，不能悄悄失效 ---------- */
{
  const M2 = new RosterMatch({ table: { li: '李', ming: '明' } });
  assert.deepEqual(M2.unknownChars('李明'), [], '表里有的字不该报');
  assert.deepEqual(M2.unknownChars('李鑫'), ['鑫'], '表里没有的字要报出来');
  n += 2;
  const bad = M2.auditRoster([{ name: '李明' }, { name: '王鑫淼' }]);
  ok(bad.includes('鑫') && bad.includes('淼') && bad.includes('王'), '整份名单的缺字要能一次查出来');
}

/* ---------- 分数线可调 ---------- */
{
  const strict = new RosterMatch({ accept: 95 });
  const r = strict.match('杨林', roster);
  ok(r.score >= 85 && !r.confident, '调高分数线之后，差一个字母的也要人确认');
}

/* ---------- 把一段话切成一个人一段 ---------- */
{
  /* 有标点的正常情况 */
  assert.deepEqual(splitSpeech('杨凌90，李明88'), ['杨凌90', '李明88'], '按标点切'); n++;
  /* 语音不给标点：数字后面紧跟汉字就是换人 —— 不做这一步，贪婪匹配会把两个人吃成一个 */
  assert.deepEqual(splitSpeech('杨凌90+30李明80+20'), ['杨凌90+30', '李明80+20'], '连读也要切开'); n++;
  /* 名字和分数之间的空格不能当分隔符 */
  assert.deepEqual(splitSpeech('李明 92'), ['李明 92'], '名字和数字之间的空格不是分隔'); n++;
  /* 数字后面还是数字或加号：还在同一个人身上 */
  assert.deepEqual(splitSpeech('李明90+20'), ['李明90+20'], '加号两边不能切开'); n++;
  assert.deepEqual(splitSpeech(''), [], '空字符串'); n++;
}

/* ---------- 下面这一组是开源前审查逐条复现出来的问题，修完钉在这里 ---------- */

/* 音节边界不能丢：拼起来都是 wangxian，但一个是 wang-xi-an，一个是 wang-xian */
{
  const r = M.match('王西安', [{ id: 1, name: '王先' }]);
  ok(!r || r.kind !== 'samePinyin', '音节数不同就不能算"读音完全相同"');
  ok(!r || !r.confident, '跨音节吞并出来的结果不能标成确定');
  assert.deepEqual(M.pinyin('王西安'), ['wang', 'xi', 'an'], '返回的是音节数组'); n++;
}

/* 多音姓：这些字在姓的位置上换个音 */
{
  const pairs = [['善宇', '单宇'], ['邱明', '仇明'], ['增强', '曾强'], ['欧阳', '区阳']];
  for (const [said, real] of pairs) {
    const r = M.match(said, [{ id: 1, name: real }]);
    ok(r && r.student.name === real, `多音姓：${said} 要能对上 ${real}`);
  }
  eq(M.pinyin('单宇')[0], 'shan', '单作姓读 shan');
  eq(M.pinyin('单')[0], 'dan', '单字不当姓看，还是 dan');
}

/* 缺字审计要覆盖扩展区汉字，不能漏 */
{
  assert.deepEqual(M.unknownChars('𠮷'), ['𠮷'], '扩展区的字查不到读音也要报出来'); n++;
}

/* 名单不干净就当场报错，不能悄悄当成同一个人 */
{
  assert.throws(() => M.match('李明', [{ name: '李明' }]), /没有 id/, '缺 id 要报错'); n++;
  assert.throws(() => M.match('李明', [{ id: 1, name: '李明' }, { id: 1, name: '李鸣' }]),
                /id 重复/, 'id 重复要报错'); n++;
  assert.throws(() => M.match('李明', [null]), /空项/, '空项要报错'); n++;
}

/* 调分数只能改排序，不能把别的层伪装成"姓名一模一样" */
{
  const S = new RosterMatch({ scores: { oneLetter: 100 } });
  const r = S.match('杨林', [{ id: 1, name: '杨凌' }, { id: 2, name: '杨琳' }]);
  eq(r.kind, 'oneLetter', '把分数调到 100 也还是 oneLetter 这一层');
  ok(r.ambiguous && !r.confident, '两个都说得通，仍然要人选');
}

/* 分句：全角数字、连续空格 */
{
  assert.deepEqual(splitSpeech('李明９０王红８０'), ['李明90', '王红80'], '全角数字要归一'); n++;
  assert.deepEqual(splitSpeech('李明  92'), ['李明 92'], '连续空格不能把人和分数拆开'); n++;
}

/* ---------- 第二轮审查复现出来的三条 ---------- */

/* 调分数把 samePinyin 顶到 exact 之上，同音检查也不能漏 */
{
  const M2 = new RosterMatch({ scores: { samePinyin: 110 }, tie: 0 });
  const r = M2.match('李明', [{ id: 1, name: '李明' }, { id: 2, name: '李鸣' }]);
  ok(r.ambiguous, '同音冲突要无条件检查，不能只在第一名是 exact 时才查');
  ok(!r.confident, '有同名/同音的就不能算确定');
  ok(r.alts.some(a => a.name === '李明'), '写法一样的那个必须出现在候选里');
}

/* 弱层级不能靠调分数变成"确定" */
{
  const M3 = new RosterMatch({ scores: { loneSurname: 99 } });
  const r = M3.match('李不存在', [{ id: 1, name: '李明' }]);
  eq(r.kind, 'loneSurname', '命中的还是"只有一个姓"这层');
  ok(!r.confident, '「名单里只有一个姓李」是猜测，给 99 分也还是猜测');
  const M4 = new RosterMatch({ scores: { sameChars: 99 } });
  ok(!M4.match('陈思达', [{ id: 1, name: '陈思远' }]).confident, '字形兜底同理');
}

/* 文档说不支持的，就要真的原样留着 */
{
  assert.deepEqual(splitSpeech('李明90分扣2分'), ['李明90分扣2分'], '加减分描述不能被当成换人'); n++;
  assert.deepEqual(splitSpeech('李明九十分王红八十'), ['李明九十分王红八十'], '中文数字连读原样留着'); n++;
  assert.deepEqual(splitSpeech('李明90分王红80'), ['李明90', '王红80'], '真的换人还是要切开'); n++;
}

console.log(`✅ 全部通过（${n} 项）`);
