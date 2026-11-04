"""Regenerate fixtures with python-docx, python-pptx, reportlab and Pillow (test-only)."""
from pathlib import Path
from io import BytesIO
from PIL import Image, ImageDraw
from docx import Document
from docx.shared import Inches
from pptx import Presentation
from pptx.util import Inches as PptInches, Pt
from pptx.dml.color import RGBColor
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.lib.utils import ImageReader
from reportlab.lib.pdfencrypt import StandardEncryption

root = Path(__file__).parent
image = Image.new('RGB', (180, 100), '#2463eb')
ImageDraw.Draw(image).rectangle((20, 20, 80, 80), fill='#fbbf24')
image_bytes = BytesIO(); image.save(image_bytes, format='PNG')

def pdf(path, encryption=None):
    c = canvas.Canvas(str(path), pagesize=(500, 360), encrypt=encryption, invariant=1)
    pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
    for page in [1, 2]:
        c.setFont('STSong-Light', 24)
        c.drawString(30, 300, f'中文文档预览 第{page}页')
        c.setFillColorRGB(.1 if page == 1 else .9, .3, .6)
        c.rect(30, 30, 400, 60, fill=1)
        c.drawImage(ImageReader(image), 30, 150, width=180, height=100)
        c.showPage()
    c.save()
pdf(root / 'preview.pdf')
pdf(root / 'locked.pdf', StandardEncryption('password'))

doc = Document()
doc.add_heading('中文 Word 第一页', 0)
doc.add_paragraph('段落、表格和图片预览')
table = doc.add_table(rows=2, cols=2); table.style = 'Table Grid'
for row, values in zip(table.rows, [['名称', '数量'], ['文档表格', '42']]):
    for cell, text in zip(row.cells, values): cell.text = text
doc.add_picture(BytesIO(image_bytes.getvalue()), width=Inches(2))
doc.add_page_break()
doc.add_heading('中文 Word 第二页', 0)
doc.add_paragraph('第二页正文')
doc.save(root / 'preview.docx')

ppt = Presentation(); ppt.slide_width = PptInches(10); ppt.slide_height = PptInches(5.625)
for page in [1, 2]:
    slide = ppt.slides.add_slide(ppt.slide_layouts[6])
    slide.background.fill.solid(); slide.background.fill.fore_color.rgb = RGBColor.from_string('E0E7FF' if page == 1 else 'FFE4D6')
    box = slide.shapes.add_textbox(PptInches(.5), PptInches(.5), PptInches(9), PptInches(1))
    run = box.text_frame.paragraphs[0].add_run(); run.text = f'中文 PPT 第{page}页'; run.font.size = Pt(32); run.font.color.rgb = RGBColor.from_string('172554')
    slide.shapes.add_picture(BytesIO(image_bytes.getvalue()), PptInches(.5), PptInches(2), width=PptInches(3))
    table = slide.shapes.add_table(2, 2, PptInches(5), PptInches(2), PptInches(4), PptInches(2)).table
    table.cell(0, 0).text = '数量'; table.cell(1, 0).text = '42'
ppt.save(root / 'preview.pptx')
