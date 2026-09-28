# 第三方内容说明

本项目自有代码按根目录 `LICENSE`（**AGPL-3.0-only**）授权。
下面这部分**不是**自有代码，按它自己的许可证授权。

---

## pypinyin（MIT）—— `pinyin-table.js` 里的读音数据

- 上游项目：https://github.com/mozillazg/python-pinyin
- 使用的数据：汉字 → 拼音音节的对应关系，覆盖 GB2312 + GBK 扩展
- 另有少量姓名用字是手工补充的（pypinyin 也会漏掉一些生僻的姓名用字）；
  补的是「某个字读什么音」这种事实性对应，不改变上游授权

MIT 要求分发时保留其版权声明和许可文本，以下为上游原文：

```
The MIT License (MIT)

Copyright (c) 2016 mozillazg, 闲耘 <hotoo.cn@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

> 复现说明：这张表可以用 pypinyin 自行生成一份替换掉 —— 它是**数据不是算法**。
> 后续版本会附上生成脚本和所用的 pypinyin 版本号。
