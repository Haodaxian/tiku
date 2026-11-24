# -*- coding: utf-8 -*-
"""
生成测试材料：整卷照片 / 单题照片 / 边界样本 / PDF / 讲义原始稿

用法（需要 Pillow）： python _生成脚本.py
输出：与本脚本同级的各子文件夹
改内容：直接改下面 P1 / P2 / P3 里的文字，或改 QUESTIONS 结构
"""
import os
import sys
import io
import zipfile
import random

from PIL import Image, ImageDraw, ImageFont, ImageFilter

sys.stdout.reconfigure(encoding='utf-8')

BASE = os.path.dirname(os.path.abspath(__file__))
A4 = (1240, 1754)          # A4 @150dpi，接近手机拍试卷的分辨率
SONG = 'C:/Windows/Fonts/simsun.ttc'
HEI = 'C:/Windows/Fonts/simhei.ttf'
KAI = 'C:/Windows/Fonts/simkai.ttf'
if not os.path.exists(KAI):
    KAI = 'C:/Windows/Fonts/msyh.ttc'

F = {}


def font(size, kind='song'):
    key = (kind, size)
    if key not in F:
        path = {'song': SONG, 'hei': HEI, 'kai': KAI}[kind]
        F[key] = ImageFont.truetype(path, size)
    return F[key]


def wrap(d, text, f, maxw):
    """按像素宽度断行，中文逐字断"""
    lines, cur = [], ''
    for ch in text:
        if d.textlength(cur + ch, font=f) <= maxw:
            cur += ch
        else:
            lines.append(cur)
            cur = ch
    if cur:
        lines.append(cur)
    return lines


class Page:
    def __init__(self, page_no, total, title, subtitle):
        self.img = Image.new('RGB', A4, 'white')
        self.d = ImageDraw.Draw(self.img)
        self.page_no = page_no
        self.total = total
        self.y = 90
        self._header(title, subtitle)
        self._margin_line()

    def _header(self, title, subtitle):
        d = self.d
        d.text((self.img.width // 2, 70), title, font=font(24, 'hei'), fill=(60, 60, 60), anchor='ma')
        d.text((self.img.width // 2, 108), subtitle, font=font(30, 'hei'), fill=(20, 20, 20), anchor='ma')
        d.line([(150, 168), (1090, 168)], fill=(90, 90, 90), width=2)
        d.text((160, 182), '班级 __________    姓名 __________    学号 ______    得分 ______',
               font=font(20), fill=(70, 70, 70))
        d.line([(150, 226), (1090, 226)], fill=(150, 150, 150), width=1)
        self.y = 250

    def _margin_line(self):
        d = self.d
        for y in range(250, self.img.height - 90, 22):
            d.line([(96, y), (96, y + 10)], fill=(190, 190, 190), width=1)
        d.text((30, self.img.height // 2), '装\n订\n线', font=font(18), fill=(180, 180, 180))

    def footer(self):
        self.d.text((self.img.width // 2, self.img.height - 60),
                    f'第 {self.page_no} 页  共 {self.total} 页',
                    font=font(20), fill=(80, 80, 80), anchor='ma')

    def gap(self, h=18):
        self.y += h

    def heading(self, text):
        self.y += 8
        self.d.text((150, self.y), text, font=font(26, 'hei'), fill=(20, 20, 20))
        self.y += 44

    def para(self, text, size=25, maxw=940, lh=None, bold=False, x=150, color=(25, 25, 25)):
        f = font(size, 'hei' if bold else 'song')
        lh = lh or int(size * 1.62)
        for line in wrap(self.d, text, f, maxw):
            self.d.text((x, self.y), line, font=f, fill=color)
            self.y += lh
        return self.y

    def options(self, opts, x=196, maxw=880, size=24):
        """两列排选项，每行两列共用同一基线"""
        f = font(size)
        col_w = maxw // 2
        step = int(size * 1.55)
        i = 0
        while i < len(opts):
            base_y = self.y
            row_h = step
            for c in range(2):
                if i >= len(opts):
                    break
                col_x = x + c * col_w
                lines = wrap(self.d, opts[i], f, col_w - 24)
                for j, line in enumerate(lines):
                    self.d.text((col_x, base_y + j * step), line, font=f, fill=(25, 25, 25))
                row_h = max(row_h, len(lines) * step)
                i += 1
            self.y = base_y + row_h + 4
        self.y += 12

    def blank_lines(self, n, x=170, w=900, gapy=46):
        for k in range(n):
            self.d.line([(x, self.y + 12), (x + w, self.y + 12)], fill=(210, 210, 210), width=1)
            self.y += gapy

    def table(self, headers, rows, col_w=None, x=170, size=21):
        cols = len(headers)
        col_w = col_w or [int(880 / cols)] * cols
        rh = 44
        cx = x
        # 表头
        for i, h in enumerate(headers):
            self.d.rectangle([cx, self.y, cx + col_w[i], self.y + rh], outline=(60, 60, 60), width=1)
            self.d.text((cx + col_w[i] // 2, self.y + rh // 2), h, font=font(size, 'hei'),
                        fill=(20, 20, 20), anchor='mm')
            cx += col_w[i]
        self.y += rh
        for row in rows:
            cx = x
            for i, cell in enumerate(row):
                self.d.rectangle([cx, self.y, cx + col_w[i], self.y + rh], outline=(60, 60, 60), width=1)
                self.d.text((cx + col_w[i] // 2, self.y + rh // 2), str(cell), font=font(size),
                            fill=(25, 25, 25), anchor='mm')
                cx += col_w[i]
            self.y += rh
        self.y += 16

    def save(self, path, quality=92):
        self.footer()
        self.img.save(path, 'JPEG', quality=quality, optimize=True)
        return path


# ============================ 第 1 页：选择 + 判断 ============================
p = Page(1, 3, '郑州市第七中学   2026—2027 学年第一学期',
         '八年级数学  单元检测（二次根式与一元二次方程）')

p.heading('一、选择题（每小题 4 分，共 20 分）')
p.para('1. 下列各数中，是无理数的是（    ）')
p.options(['A. √4', 'B. 22/7', 'C. π', 'D. 0.1010010001'])
p.para('2. 若 x² - 5x + 6 = 0，则 x 的值是（    ）')
p.options(['A. 2 或 3', 'B. -2 或 -3', 'C. 1 或 6', 'D. -1 或 -6'])
p.para('3. 一次函数 y = -2x + 3 的图象不经过（    ）')
p.options(['A. 第一象限', 'B. 第二象限', 'C. 第三象限', 'D. 第四象限'])
p.para('4. （多选）下列命题中，真命题有（    ）')
p.options(['A. 对顶角相等', 'B. 两直线平行，同位角相等',
           'C. 若 a² = b²，则 a = b', 'D. 三角形的内角和等于 180°'])
p.para('5. 下列二次根式中，属于最简二次根式的是（    ）')
p.options(['A. √8', 'B. √(1/2)', 'C. √6', 'D. √12'])

p.gap(6)
p.heading('二、判断题（每小题 2 分，共 6 分，对的打 √，错的打 ×）')
p.para('6. 两条直线被第三条直线所截，内错角一定相等。（    ）')
p.para('7. √(a²) = a 对任意实数 a 都成立。（    ）')
p.para('8. 一次函数 y = kx + b 中，k ≠ 0。（    ）')

p.gap(10)
p.para('温馨提示：请把答案填写在答题卡上，考试结束后试卷与答题卡一并交回。',
       size=20, color=(120, 120, 120))
os.makedirs(os.path.join(BASE, '01-整卷照片'), exist_ok=True)
p1 = p.save(os.path.join(BASE, '01-整卷照片', '八年级数学-第1页-选择题.jpg'))

# ============================ 第 2 页：填空 + 解答 ============================
p = Page(2, 3, '郑州市第七中学   2026—2027 学年第一学期',
         '八年级数学  单元检测（二次根式与一元二次方程）')

p.heading('三、填空题（每小题 4 分，共 16 分）')
p.para('9. 若 √(x - 3) 有意义，则 x 的取值范围是 ____________。')
p.para('10. 分解因式：a³ - 4a = ____________。')
p.para('11. 已知一次函数 y = kx + b 的图象经过点 (1, 3) 和 (-1, -1)，则 k = ________，b = ________。')
p.para('12. 计算：(√12 - √(1/3)) × √3 = ____________。')

p.gap(8)
p.heading('四、解答题（共 24 分，要求写出解题过程）')
p.para('13.（8 分）解方程：x² - 6x + 8 = 0')
p.blank_lines(4)
p.para('14.（8 分）先化简，再求值：(a + 2)² - (a + 1)(a - 1)，其中 a = -3。')
p.blank_lines(4)
p.para('15.（8 分）某商店购进一批文具，进价每件 8 元，售价每件 12 元。')
p.para('若想获得不低于 800 元的利润，至少需要卖出多少件？请列不等式解答。')
p.blank_lines(5)

p2 = p.save(os.path.join(BASE, '01-整卷照片', '八年级数学-第2页-填空解答.jpg'))

# ============================ 第 3 页：几何图 + 表格 + 应用题 ============================
p = Page(3, 3, '郑州市第七中学   2026—2027 学年第一学期',
         '八年级数学  单元检测（二次根式与一元二次方程）')

p.heading('五、几何与统计（共 30 分）')

# 16 题 + 三角形图
p.para('16.（10 分）如图，在 △ABC 中，AB = AC，∠BAC = 40°，AD ⊥ BC 于点 D，')
p.para('求 ∠BAD 的度数。')
top = p.y + 10
ax, ay = 300, top + 150
bx, by = 190, top + 300
cx, cy = 420, top + 300
dx, dy = (bx + cx) // 2, by
p.d.polygon([(ax, ay), (bx, by), (cx, cy)], outline=(20, 20, 20))
p.d.line([(ax, ay), (ax, ay)], width=2)
p.d.polygon([(ax, ay), (bx, by), (cx, cy)], outline=(20, 20, 20), width=3)
p.d.line([(ax, ay), (dx, dy)], fill=(20, 20, 20), width=2)
p.d.line([(dx - 10, dy - 10), (dx + 6, dy - 10)], fill=(20, 20, 20), width=2)
p.d.text((ax - 18, ay - 34), 'A', font=font(24, 'kai'), fill=(20, 20, 20))
p.d.text((bx - 34, by + 8), 'B', font=font(24, 'kai'), fill=(20, 20, 20))
p.d.text((cx + 14, cy + 8), 'C', font=font(24, 'kai'), fill=(20, 20, 20))
p.d.text((dx - 6, dy + 6), 'D', font=font(24, 'kai'), fill=(20, 20, 20))
p.y = cy + 40

# 学生手写答案（测试：手写内容不该被当成标准答案）
hand = '解：∵ AB = AC，AD ⊥ BC  ∴ ∠BAD = 1/2 ∠BAC = 20°'
p.d.text((170, p.y), hand, font=font(26, 'kai'), fill=(200, 30, 30))
p.y += 60

p.para('17.（10 分）某班 40 名学生一次数学测验成绩的频数分布如下表，')
p.para('求中位数所在的小组。')
p.table(['分组（分）', '50~60', '60~70', '70~80', '80~90', '90~100'],
        [['频数（人）', 2, 6, 14, 12, 6]])
p.blank_lines(3)

p.para('18.（10 分）某公园门票价格如下表。小明一家 5 人共付门票 340 元，')
p.para('求成人票与儿童票各买了多少张（列方程解答）。')
p.table(['票种', '成人票', '儿童票'], [['单价（元/张）', 80, 40]], col_w=[280, 300, 300])
p.blank_lines(4)

p3 = p.save(os.path.join(BASE, '01-整卷照片', '八年级数学-第3页-几何统计.jpg'))

# ============================ 单题照片（模拟手机拍摄） ============================
os.makedirs(os.path.join(BASE, '02-单题照片'), exist_ok=True)


def shoot(title, lines, out_name, draw_extra=None, extra_h=0, w=980, tilt=1.4, blur=0):
    """白纸 -> 灰桌面 -> 轻微倾斜 + 阴影，模拟真实手机拍摄"""
    paper = Image.new('RGB', (w, 1000), (252, 251, 248))
    d = ImageDraw.Draw(paper)
    y = 46
    for part in wrap(d, title, font(27), w - 112):
        d.text((56, y), part, font=font(27), fill=(30, 30, 30))
        y += 46
    y += 8
    for ln in lines:
        for part in wrap(d, ln, font(25), w - 112):
            d.text((56, y), part, font=font(25), fill=(30, 30, 30))
            y += 42
        y += 6
    if draw_extra:
        draw_extra(d, y + 6)
    h = min(paper.height, max(260, y + extra_h + 70))
    paper = paper.crop((0, 0, w, h))

    # 桌面背景
    desk = Image.new('RGB', (w + 220, h + 200), (168, 162, 152))
    dd = ImageDraw.Draw(desk)
    for k in range(0, desk.height, 4):
        dd.line([(0, k), (desk.width, k)], fill=(168 + random.randint(-4, 4), 162, 152))
    # 阴影
    shadow = Image.new('L', desk.size, 0)
    ImageDraw.Draw(shadow).rectangle([120, 110, 120 + w, 110 + h], fill=120)
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    desk.paste(Image.new('RGB', desk.size, (90, 86, 80)), (0, 0), shadow)
    # 贴纸
    paper = paper.rotate(tilt, resample=Image.BICUBIC, expand=True, fillcolor=(252, 251, 248))
    desk.paste(paper, (110, 95))
    if blur:
        desk = desk.filter(ImageFilter.GaussianBlur(blur))
    out = os.path.join(BASE, '02-单题照片', out_name)
    desk.save(out, 'JPEG', quality=90, optimize=True)
    return out


shoot('2. 若 x² - 5x + 6 = 0，则 x 的值是（    ）',
      ['A. 2 或 3      B. -2 或 -3      C. 1 或 6      D. -1 或 -6'],
      '单题-选择题.jpg')


def tri(d, y):
    ax, ay = 330, y + 20
    bx, by = 200, y + 200
    cx, cy = 460, y + 200
    dx, dy = (bx + cx) // 2, by
    d.polygon([(ax, ay), (bx, by), (cx, cy)], outline=(20, 20, 20), width=3)
    d.line([(ax, ay), (dx, dy)], fill=(20, 20, 20), width=2)
    d.text((ax - 18, ay - 34), 'A', font=font(24, 'kai'), fill=(20, 20, 20))
    d.text((bx - 34, by + 6), 'B', font=font(24, 'kai'), fill=(20, 20, 20))
    d.text((cx + 12, cy + 6), 'C', font=font(24, 'kai'), fill=(20, 20, 20))
    d.text((dx - 6, dy + 6), 'D', font=font(24, 'kai'), fill=(20, 20, 20))


shoot('16. 如图，在 △ABC 中，AB = AC，∠BAC = 40°，AD ⊥ BC 于点 D，',
      ['求 ∠BAD 的度数。'], '单题-几何解答.jpg',
      draw_extra=tri, extra_h=230)

shoot('9. 若 √(x - 3) 有意义，则 x 的取值范围是 ____________。',
      ['10. 分解因式：a³ - 4a = ____________。'],
      '单题-两个填空.jpg')

# 化学：测跨学科与上下标
shoot('1. 下列关于二氧化碳的说法正确的是（    ）',
      ['A. CO2 属于有机物',
       'B. CO2 通入紫色石蕊试液，溶液变红',
       'C. CO2 能使澄清石灰水变浑浊：CO2 + Ca(OH)2 = CaCO3↓ + H2O',
       'D. 实验室用大理石与稀硫酸反应制取 CO2'],
      '单题-化学.jpg')

# 语文：长文本 + 默写横线
shoot('7. 古诗文默写。（每空 1 分）',
      ['（1）山重水复疑无路，____________________。（陆游《游山西村》）',
       '（2）____________________，江春入旧年。（王湾《次北固山下》）',
       '（3）《陋室铭》中写主人交往之雅的句子是：__________，__________。'],
      '单题-语文默写.jpg')

print('整卷 3 页 + 单题 5 张 已生成')

# ============================ 边界样本 ============================
os.makedirs(os.path.join(BASE, '03-边界样本'), exist_ok=True)

# 1. 极模糊
src = Image.open(os.path.join(BASE, '02-单题照片', '单题-选择题.jpg'))
src.filter(ImageFilter.GaussianBlur(5)).save(
    os.path.join(BASE, '03-边界样本', '边界-极模糊.jpg'), 'JPEG', quality=85)

# 2. 空白页
blank = Page(1, 1, '郑州市第七中学   2026—2027 学年第一学期', '八年级数学  单元检测')
blank.y = 420
blank.para('（本题答题区）', size=22, color=(200, 200, 200))
blank.save(os.path.join(BASE, '03-边界样本', '边界-空白页.jpg'))

# 3. 倒置 180
Image.open(os.path.join(BASE, '02-单题照片', '单题-几何解答.jpg')).rotate(180, expand=True).save(
    os.path.join(BASE, '03-边界样本', '边界-倒置180度.jpg'), 'JPEG', quality=88)

# 4. 旋转 90
Image.open(os.path.join(BASE, '02-单题照片', '单题-两个填空.jpg')).rotate(90, expand=True).save(
    os.path.join(BASE, '03-边界样本', '边界-旋转90度.jpg'), 'JPEG', quality=88)

# 5. 超大图（4000x3000, 高体积）
big = Image.open(p1).resize((3000, 4243), Image.LANCZOS)
big.save(os.path.join(BASE, '03-边界样本', '边界-超大图3000宽.jpg'), 'JPEG', quality=95)

# 6. 非题目（通知）
notice = Image.new('RGB', (1000, 700), (252, 252, 250))
d = ImageDraw.Draw(notice)
d.text((500, 70), '关于本周教研活动的通知', font=font(36, 'hei'), fill=(20, 20, 20), anchor='ma')
body = ['各位老师：',
        '本周四下午第三节课，全组教师在办公楼三楼会议室开展集体备课活动。',
        '请各位老师提前准备本单元教学设计一份，活动时长约 40 分钟。',
        '因故不能参加的老师，请提前向教研组长请假。',
        '教务处',
        '2026 年 11 月 12 日']
y = 170
for ln in body:
    for part in wrap(d, ln, font(24), 860):
        d.text((70, y), part, font=font(24), fill=(30, 30, 30))
        y += 44
    y += 12
notice.save(os.path.join(BASE, '03-边界样本', '边界-非题目通知.jpg'), 'JPEG', quality=90)

# 7. 两题间距极小（测不合并）
tight = Page(1, 1, '测试专用', '题间距极小：两题紧贴')
tight.heading('一、选择题')
tight.para('1. 计算 2 + 3 × 4 的结果是（    ）')
tight.para('A. 14    B. 20    C. 24    D. 9', size=24)
tight.y += 2
tight.para('2. 计算 (2 + 3) × 4 的结果是（    ）')
tight.para('A. 14    B. 20    C. 24    D. 9', size=24)
tight.save(os.path.join(BASE, '03-边界样本', '边界-两题紧贴.jpg'))

# 8. 纯手写（老师手写教案上的题）
hw = Image.new('RGB', (1000, 700), (253, 252, 246))
d = ImageDraw.Draw(hw)
d.line([(80, 120), (920, 120)], fill=(150, 190, 230), width=2)
d.line([(80, 220), (920, 220)], fill=(150, 190, 230), width=2)
d.line([(80, 320), (920, 320)], fill=(150, 190, 230), width=2)
d.line([(80, 420), (920, 420)], fill=(150, 190, 230), width=2)
d.text((90, 150), '3. 已知 a+b=5，ab=6，求 a²+b² 的值。', font=font(30, 'kai'), fill=(30, 40, 120))
d.text((90, 250), '解：a²+b²=(a+b)²-2ab=25-12=13', font=font(30, 'kai'), fill=(30, 40, 120))
hw.save(os.path.join(BASE, '03-边界样本', '边界-纯手写.jpg'), 'JPEG', quality=92)

print('边界样本 8 张 已生成')

# ============================ PDF ============================
os.makedirs(os.path.join(BASE, '04-PDF'), exist_ok=True)
pages = [Image.open(os.path.join(BASE, '01-整卷照片', f'八年级数学-第{i}页-{n}.jpg')).convert('RGB')
         for i, n in [(1, '选择题'), (2, '填空解答'), (3, '几何统计')]]
pdf_path = os.path.join(BASE, '04-PDF', '八年级数学单元测试-共3页.pdf')
pages[0].save(pdf_path, 'PDF', save_all=True, append_images=pages[1:], resolution=150.0)

# 灰度扫描件风 PDF（测扫描件能不能框选识题）
scan = []
for im in pages:
    g = im.convert('L').convert('RGB')
    g = g.filter(ImageFilter.GaussianBlur(0.6))
    scan.append(g)
pdf2 = os.path.join(BASE, '04-PDF', '八年级数学单元测试-扫描件灰度.pdf')
scan[0].save(pdf2, 'PDF', save_all=True, append_images=scan[1:], resolution=150.0)
print('PDF 2 份 已生成')

# ============================ 讲义原始稿 ============================
os.makedirs(os.path.join(BASE, '05-讲义原文'), exist_ok=True)

TXT = """一元二次方程 复习课讲义（原始稿，格式很乱，正好用来测排版）

这节课要讲一元二次方程。定义：只含有一个未知数，并且未知数的最高次数是 2 的整式方程，叫做一元二次方程，一般形式 ax²+bx+c=0（a≠0）。注意 a 不能等于 0，b、c 可以等于 0。举个例子 3x²-5x+2=0 就是，a=3,b=-5,c=2。而 x²+1/x=0 不是，因为有分式。
四种解法：直接开平方法、配方法、公式法、因式分解法。直接开平方法适合 (x+m)²=n（n≥0）这种。配方法步骤：二次项系数化为 1，移常数项，两边加一次项系数一半的平方，左边写成完全平方。公式法：先算判别式 Δ=b²-4ac，Δ>0 有两个不相等实根，Δ=0 有两个相等实根，Δ<0 没有实根，求根公式 x=(-b±√(b²-4ac))/2a。因式分解法：把方程化成两个一次因式乘积等于 0，然后分别令每个因式为 0。十字相乘在二次三项式里很快。
韦达定理：x1+x2=-b/a，x1x2=c/a。常见变形：x1²+x2²=(x1+x2)²-2x1x2；1/x1+1/x2=(x1+x2)/x1x2；(x1-x2)²=(x1+x2)²-4x1x2。用韦达定理前一定先确认 Δ≥0。
易错点提醒：1、解方程时两边同时除以含未知数的式子会丢根，比如 x²=3x 不能直接除以 x 得 x=3，应该移项因式分解得 x(x-3)=0，所以 x=0 或 x=3。2、配方时常数项算出错。3、实际应用题求出根以后要检验是否符合实际意义，比如长度不能为负，人数必须是正整数。
典型例题一：解方程 x²-6x+8=0。可以用因式分解 (x-2)(x-4)=0，得 x=2 或 x=4；也可以配方 (x-3)²=1。
典型例题二：某商品原价 100 元，连续两次降价后为 81 元，求平均每次降价的百分率。设下降率为 x，列方程 100(1-x)²=81，解得 x=0.1 或 x=1.9（舍），所以每次降价 10%。
课堂练习（留给学生做）：1、解方程 2x²-5x+2=0。2、已知方程 x²+3x-1=0 的两根为 x1、x2，求 x1²+x2²。3、一个直角三角形两条直角边相差 3，斜边为 15，求两条直角边。
作业：课本 P42 习题 2、3、5；练习册第 12 页全部。
"""

with io.open(os.path.join(BASE, '05-讲义原文', '一元二次方程-原始稿-乱格式.txt'),
             'w', encoding='utf-8', newline='\r\n') as f:
    f.write(TXT)

SHORT = """《三角形的全等》这节课的内容：
全等三角形的判定有 SSS、SAS、ASA、AAS，直角三角形还有 HL。注意 SSA 不能判定全等，AAA 也不能。
全等三角形的性质是对应边相等、对应角相等。
证明题一般先找已知条件，再找隐含条件（公共边、公共角、对顶角），最后写判定依据。
"""
with io.open(os.path.join(BASE, '05-讲义原文', '三角形全等-很短的一段.txt'),
             'w', encoding='utf-8', newline='\r\n') as f:
    f.write(SHORT)


def make_docx(path, paragraphs):
    """手写最小可用 docx（.docx 就是 zip + XML）"""
    def esc(s):
        return (s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))

    body = []
    for ptext in paragraphs:
        body.append(
            '<w:p><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr>'
            '<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体"/>'
            '<w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">' + esc(ptext) + '</w:t></w:r></w:p>'
        )
    document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                '<w:body>' + ''.join(body) +
                '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>')
    content_types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                     '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                     '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                     '<Default Extension="xml" ContentType="application/xml"/>'
                     '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                     '</Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '</Relationships>')
    doc_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', content_types)
        z.writestr('_rels/.rels', rels)
        z.writestr('word/document.xml', document)
        z.writestr('word/_rels/document.xml.rels', doc_rels)


make_docx(os.path.join(BASE, '05-讲义原文', '整式乘法与因式分解-原始稿.docx'), [
    '整式乘法与因式分解（备课原稿）',
    '一、单项式乘单项式：系数相乘，同底数幂相乘，只在一个单项式里含有的字母连同指数照抄。例如 3a²b · 2ab³ = 6a³b⁴。',
    '二、单项式乘多项式：用单项式去乘多项式的每一项，再把所得的积相加。m(a+b+c)=ma+mb+mc。',
    '三、多项式乘多项式：(a+b)(m+n)=am+an+bm+bn，注意不要漏项，符号要看清楚。',
    '四、平方差公式：(a+b)(a-b)=a²-b²。特点是两个二项式相乘，一项完全相同，另一项互为相反数。',
    '五、完全平方公式：(a±b)²=a²±2ab+b²。口诀：首平方，尾平方，两倍乘积放中央，符号看前方。',
    '六、因式分解的步骤：一提（公因式）、二套（公式）、三十字（相乘）、四分组。分解要彻底，直到每个因式都不能再分解为止。',
    '易错提醒：a²+b² 不能分解成 (a+b)²；分解结果要写成乘积形式；公因式要提干净，包括系数和字母两部分。',
    '课堂练习：1. 计算 (-2x²y)³。2. 分解因式 3a²-12。3. 分解因式 x²+4x+4-y²。',
])
print('讲义原稿 3 份 已生成')

# ============================ 题库备份样例 ============================
os.makedirs(os.path.join(BASE, '06-题库备份样例'), exist_ok=True)
import json

now = 1763200000000  # 固定时间戳，保证可复现
demo = [
    ('若 √(x - 3) 有意义，则 x 的取值范围是？', '填空题', [], 'x ≥ 3', '二次根式有意义的条件是被开方数非负。', ['二次根式'], '简单'),
    ('解方程：x² - 6x + 8 = 0', '解答题', [], 'x1 = 2，x2 = 4',
     '因式分解得 (x-2)(x-4)=0，所以 x=2 或 x=4。', ['一元二次方程', '因式分解法'], '中等'),
    ('一次函数 y = -2x + 3 的图象不经过哪个象限？', '单选题',
     [{'key': 'A', 'text': '第一象限'}, {'key': 'B', 'text': '第二象限'},
      {'key': 'C', 'text': '第三象限'}, {'key': 'D', 'text': '第四象限'}], 'C',
     'k<0、b>0，图象过一、二、四象限，不过第三象限。', ['一次函数', '图象'], '中等'),
    ('下列各数中，是无理数的是？', '单选题',
     [{'key': 'A', 'text': '√4'}, {'key': 'B', 'text': '22/7'},
      {'key': 'C', 'text': 'π'}, {'key': 'D', 'text': '0.1010010001'}], 'C',
     'π 是无限不循环小数；√4=2，22/7 与 D 都是有理数。', ['实数', '无理数'], '简单'),
    ('两条直线被第三条直线所截，内错角一定相等。', '判断题', [], '×',
     '只有两直线平行时内错角才相等。', ['平行线', '三线八角'], '简单'),
    ('一次函数 y = kx + b 中，k ≠ 0。', '判断题', [], '√',
     '一次函数的定义要求一次项系数不为零。', ['一次函数'], '简单'),
    ('分解因式：a³ - 4a = ？', '填空题', [], 'a(a+2)(a-2)',
     '先提公因式 a，再用平方差公式。', ['因式分解', '平方差公式'], '中等'),
    ('计算：(√12 - √(1/3)) × √3 = ？', '填空题', [], '5',
     '√12=2√3，√(1/3)=√3/3，相减得 5√3/3，再乘 √3 得 5。', ['二次根式', '化简'], '中等'),
    ('（多选）下列命题中，真命题有？', '多选题',
     [{'key': 'A', 'text': '对顶角相等'}, {'key': 'B', 'text': '两直线平行，同位角相等'},
      {'key': 'C', 'text': '若 a² = b²，则 a = b'}, {'key': 'D', 'text': '三角形的内角和等于 180°'}],
     'ABD', 'C 错，a 与 b 也可能互为相反数。', ['命题', '平行线', '三角形'], '中等'),
    ('如图，在 △ABC 中，AB = AC，∠BAC = 40°，AD ⊥ BC 于点 D，求 ∠BAD 的度数。', '解答题',
     [], '20°', '等腰三角形底边上的高也是顶角平分线，故 ∠BAD = 20°。',
     ['等腰三角形', '三线合一'], '中等'),
    ('某班 40 名学生成绩频数分布表：50~60 有 2 人，60~70 有 6 人，70~80 有 14 人，80~90 有 12 人，90~100 有 6 人，求中位数所在小组。',
     '解答题', [], '70~80 分', '第 20、21 个数据都落在 70~80 组。', ['统计', '中位数'], '较难'),
    ('先化简，再求值：(a + 2)² - (a + 1)(a - 1)，其中 a = -3。', '解答题', [], '-7',
     '原式 = a²+4a+4 - (a²-1) = 4a+5，代入 a=-3 得 -7。',
     ['整式乘法', '化简求值'], '较难'),
    ('某商店购进文具，进价每件 8 元，售价每件 12 元，想获得不低于 800 元利润，至少卖出多少件？',
     '解答题', [], '200 件', '设卖出 x 件，(12-8)x ≥ 800，x ≥ 200。', ['一元一次不等式', '应用题'], '中等'),
    ('下列二次根式中，属于最简二次根式的是？', '单选题',
     [{'key': 'A', 'text': '√8'}, {'key': 'B', 'text': '√(1/2)'},
      {'key': 'C', 'text': '√6'}, {'key': 'D', 'text': '√12'}], 'C',
     '√8=2√2，√(1/2)=√2/2，√12=2√3，只有 √6 无法再化简。', ['二次根式', '最简二次根式'], '简单'),
    ('下列关于二氧化碳的说法正确的是？', '单选题',
     [{'key': 'A', 'text': 'CO2 属于有机物'},
      {'key': 'B', 'text': 'CO2 通入紫色石蕊试液，溶液变红'},
      {'key': 'C', 'text': 'CO2 能使澄清石灰水变浑浊'},
      {'key': 'D', 'text': '实验室用大理石与稀硫酸反应制取 CO2'}], 'BC',
     'A 错，CO2 属无机物；D 错，稀硫酸与大理石生成微溶的硫酸钙会阻碍反应。',
     ['二氧化碳', '酸碱指示剂'], '中等'),
    ('古诗文默写：山重水复疑无路，________。（陆游《游山西村》）', '填空题', [],
     '柳暗花明又一村', '出自陆游《游山西村》颔联。', ['古诗文默写'], '简单'),
    ('已知 a+b=5，ab=6，求 a²+b² 的值。', '解答题', [], '13',
     'a²+b²=(a+b)²-2ab=25-12=13。', ['完全平方公式', '韦达定理'], '中等'),
    ('已知方程 x²+3x-1=0 的两根为 x1、x2，求 x1²+x2²。', '解答题', [], '11',
     'x1+x2=-3，x1x2=-1，x1²+x2²=9+2=11。', ['一元二次方程', '韦达定理'], '较难'),
    ('一个直角三角形两条直角边相差 3，斜边为 15，求两条直角边。', '解答题', [], '9 和 12',
     '设短边为 x，x²+(x+3)²=225，解得 x=9（舍去负根）。', ['勾股定理', '一元二次方程'], '较难'),
    ('某商品原价 100 元，连续两次降价后为 81 元，求平均每次降价的百分率。', '解答题', [], '10%',
     '100(1-x)²=81，得 x=0.1 或 1.9（舍），故为 10%。', ['一元二次方程', '增长率问题'], '较难'),
    ('判断：若 a² = b²，则 a = b。', '判断题', [], '×',
     '反例：a=2、b=-2，平方相等但不相等。', ['实数', '命题'], '简单'),
]

questions = []
for i, (stem, qtype, options, answer, analysis, knowledge, diff) in enumerate(demo):
    questions.append({
        'id': 'q_demo_%02d' % (i + 1),
        'stem': stem,
        'type': qtype,
        'options': options,
        'answer': answer,
        'analysis': analysis,
        'knowledge': knowledge,
        'difficulty': diff,
        'subject': '数学',
        'grade': '八年级',
        'source': '测试样例',
        'image': '',
        'folderId': 'f_demo',
        'createdAt': now + i * 60000,
        'updatedAt': now + i * 60000,
    })

backup = {
    'exportedAt': '2026-11-15T02:00:00.000Z',
    'folders': [{'id': 'f_demo', 'name': '八年级数学（测试）', 'createdAt': now}],
    'questions': questions,
    'lectures': [],
}
with io.open(os.path.join(BASE, '06-题库备份样例', '示例备份-21道题-可直接导入.json'),
             'w', encoding='utf-8') as f:
    json.dump(backup, f, ensure_ascii=False, indent=2)

print('题库备份样例 已生成（20 道题）')
print('\n全部完成，输出目录：' + BASE)
