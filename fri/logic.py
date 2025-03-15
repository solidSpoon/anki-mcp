import os
import tkinter as tk
from pathlib import Path
from tkinter import filedialog
import hashlib

import openai
import pandas as pd
from dotenv import load_dotenv


def setup_openai():
    load_dotenv()
    api_key = os.getenv('OPENAI_API_KEY')
    api_base = os.getenv('OPENAI_API_BASE')

    if not api_key:
        raise ValueError("Please set the OPENAI_API_KEY environment variable.")

    openai.api_key = api_key
    print(f"API Key (first 5 characters): {api_key[:5]}...")

    if api_base:
        openai.base_url = api_base
        print(f"Using custom OpenAI API base URL: {api_base}")
    else:
        print("Using default OpenAI API base URL")

    print(f"Actual API Key being used (first 5 characters): {openai.api_key[:5]}...")
    print(f"Actual API base URL being used: {openai.base_url}")


def select_excel_file():
    root = tk.Tk()
    root.withdraw()
    file_types = [('Excel files', '*.xlsx'), ('Excel files', '*.xls')]
    file_path = filedialog.askopenfilename(filetypes=file_types)
    if not file_path:
        raise ValueError("No file selected. Exiting.")
    return file_path


def format_word_for_filename(word):
    """将单词或词组转换为文件名friendly的格式"""
    return word.replace(' ', '_').lower()


def get_stable_hash(text):
    """生成稳定的哈希值（前8位）"""
    return hashlib.md5(text.encode('utf-8')).hexdigest()[:8]


def create_audio_file(text, word, audio_type, audio_dir):
    """
    创建音频文件
    :param text: 要转换为语音的文本
    :param word: 单词或词组
    :param audio_type: 音频类型（word/meaning/sentence）
    :param audio_dir: 音频文件目录
    :return: 音频文件名
    """
    formatted_word = format_word_for_filename(word)
    stable_hash = get_stable_hash(text)
    audio_filename = f"{formatted_word}-{audio_type}-{stable_hash}.mp3"
    audio_path = audio_dir / audio_filename

    if not audio_path.exists():
        response = openai.audio.speech.create(
            model="tts-1",
            voice="alloy",
            input=text
        )

        audio_data = response.content

        with open(audio_path, 'wb') as f:
            f.write(audio_data)

    return audio_filename


def generate_anki_cards():
    setup_openai()

    # 创建输出目录结构
    output_dir = Path('out/anki')
    output_dir.mkdir(parents=True, exist_ok=True)

    audio_dir = output_dir / 'audio_files'
    audio_dir.mkdir(exist_ok=True)

    file_path = select_excel_file()
    df = pd.read_excel(file_path)

    # 过滤出 Imported 为 No 的行
    df_to_import = df[df['Imported'].fillna('No').str.strip().str.upper() != 'YES']
    total_rows = len(df_to_import)

    if total_rows == 0:
        print("没有需要导入的新词条")
        return

    print(f"找到 {total_rows} 个需要导入的词条")

    anki_file_path = output_dir / 'anki_import.txt'
    with open(anki_file_path, 'w', encoding='utf-8') as anki_file:
        # 写入字段说明
        anki_file.write("#separator:tab\n")
        anki_file.write("#html:true\n")
        anki_file.write("#columns:Word\tWordAudio\tDefinition\tDefinitionAudio\tExample\tExampleAudio\n")

        for index, row in df_to_import.iterrows():
            word = row['Word/Phrase'].strip()
            definition = row['Definition'].strip()
            example = row['Example Sentence'].strip()

            print(f"\n处理第 {index + 1}/{total_rows} 个词条: {word}")

            # 生成音频文件
            print("  生成单词发音...")
            word_audio = create_audio_file(word, word, "word", audio_dir)

            print("  生成释义发音...")
            meaning_audio = create_audio_file(definition, word, "meaning", audio_dir)

            print("  生成例句发音...")
            sentence_audio = create_audio_file(example, word, "sentence", audio_dir)

            # 准备字段内容
            fields = [
                word,  # 字段1：单词
                f"[sound:{word_audio}]",  # 字段2：单词发音
                definition,  # 字段3：释义
                f"[sound:{meaning_audio}]",  # 字段4：释义发音
                example,  # 字段5：例句
                f"[sound:{sentence_audio}]"  # 字段6：例句发音
            ]

            # 使用 tab 分隔符连接字段
            line = "\t".join(fields)
            anki_file.write(f"{line}\n")
            print("  ✓ 完成")

    print(f"\n所有词条处理完成！")
    print(f"Anki import file and audio files have been created in {output_dir}")
    print("\n导入说明：")
    print("1. 在 Anki 中创建新的笔记类型，包含以下字段：")
    print("   - Word")
    print("   - WordAudio")
    print("   - Definition")
    print("   - DefinitionAudio")
    print("   - Example")
    print("   - ExampleAudio")
    print("2. 将 audio_files 文件夹中的所有 .mp3 文件复制到 Anki 的媒体文件夹中")
    print("   (可通过 工具->检查媒体 来找到媒体文件夹)")
    print("3. 在 Anki 中选择 文件->导入")
    print("4. 选择生成的 anki_import.txt 文件")
    print("5. 导入设置：")
    print("   - 文本分隔符类型：制表符")
    print("   - 选择之前创建的笔记类型")
    print("   - 确保字段映射正确")
    print("6. 点击导入完成")


if __name__ == "__main__":
    generate_anki_cards()
