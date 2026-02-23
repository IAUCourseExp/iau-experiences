import json
import re
import os
import requests
import datetime

BOT_TOKEN = os.environ.get("BOT_TOKEN")
CHANNEL_ID = "@IAUCourseExp"
CLEAN_CH_ID = CHANNEL_ID.replace('@', '')
DATA_FILE = "src/data.json"


def clean_text(text):
    if not text: return ""
    return text.replace('#', '').replace('_', ' ').strip()

def parse_experience(message_text, msg_id):
    course_match = re.search(r"(?:📚|🟡)\s*(?:نام\s+)?درس\s*[:：]?\s*(.*?)(?=\n|🧮|🟢|🧑‍🏫|🔵|$)", message_text, re.DOTALL)
    prof_match = re.search(r"(?:🧑‍🏫|🔵)\s*(?:نام\s+استاد\s+مربوطه|استاد)\s*[:：]?\s*(.*?)(?=\n|❓|💬|🔴|$)", message_text, re.DOTALL)
    
    student_score = "?"
    student_score_match = re.search(r"(?:🧮|🟢)\s*(?:نمره|نمرتون)\s*[:：]?\s*(.*?)(?=\n|🧑‍🏫|🔵|❓|$)", message_text)
    if student_score_match:
        scores = re.findall(r"(\d+(?:\.\d+)?)", student_score_match.group(1).strip())
        student_score = scores[0] if scores else "?"

    prof_score = "?"
    prof_field_area = re.search(r"❓\s*نمره ی شما به استاد.*?(?=\n\s*(?:💬|🔴|🆔|$))", message_text, re.DOTALL)
    if prof_field_area:
        text_to_search = re.sub(r"\(.*?\d+.*?\d+.*?\)", "", prof_field_area.group(0))
        scores = re.findall(r"(\d+(?:\.\d+)?)", text_to_search)
        prof_score = scores[0] if scores else "?"

    text_match = re.search(r"(?:💬|🔴)\s*(?:تجربه\s+شما|دیدگاه\s+شما|نظرتون|نظر).*?[:：]\s*(.*?)(?=\n*-{5,}|\n*لطفا\s+از\s+طریق|$)", message_text, re.DOTALL)

    if course_match and prof_match:
        return {
            "id": 0,
            "Link": f"https://t.me/{CLEAN_CH_ID}/{msg_id}",
            "course": ' '.join(clean_text(course_match.group(1)).split()),
            "Student_Score": student_score,
            "Professor_Score": prof_score,
            "professor": prof_match.group(1).strip(),
            "text": re.sub(r"\n*❗️توجه❗️.*", "", text_match.group(1).strip(), flags=re.DOTALL) if text_match else "بدون متن"
        }
    return None

def scrape_with_bot():
    last_update_id = 0
    
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            database = json.load(f)
    else:
        database = []

    existing_links = {item['Link'] for item in database}

    url = f"https://api.telegram.org/bot{BOT_TOKEN}/getUpdates"
    
    try:
        response = requests.get(url, timeout=10).json()
    except Exception as e:
        print(f"❌ خطای شبکه (احتمالا پروکسی روشن نیست): {e}")
        return

    if not response.get("ok"):
        print(f"❌ خطا از سمت تلگرام: {response.get('description')}")
        return

    if database:
        current_max_id = max(item['id'] for item in database)
    else:
        current_max_id = 0

    new_entries = []
    for update in response.get("result", []):
        last_update_id = update.get("update_id")
        message = update.get("channel_post")
        if not message: continue
        
        msg_id = message.get("message_id")
        msg_text = message.get("text", "")
        msg_link = f"https://t.me/{CLEAN_CH_ID}/{msg_id}"

        if msg_link in existing_links:
            continue

        if any(indicator in msg_text for indicator in ["📚نام درس", "🟡درس"]):
            extracted = parse_experience(msg_text, msg_id)
            if extracted:
                current_max_id += 1
                extracted["id"] = current_max_id
                new_entries.append(extracted)
                
                new_item["id"] = current_max_id 

                new_entries.append(new_item)
                existing_links.add(msg_link)

    if last_update_id > 0:
        try:
            requests.get(f"https://api.telegram.org/bot{BOT_TOKEN}/getUpdates?offset={last_update_id + 1}", timeout=5)
            print(f"--- آپدیت‌ها تا آی‌دی {last_update_id} تایید شدند ---")
        except:
            print("⚠️ خطای کوچک در تایید آپدیت‌ها به تلگرام")

    if new_entries:
        database.extend(new_entries)
        with open(DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(database, f, ensure_ascii=False, indent=4)
        
        now = datetime.datetime.utcnow() + datetime.timedelta(hours=3, minutes=30)
        update_info = {
            "last_update": now.strftime("%Y/%m/%d - %H:%M")
        }
        
        with open("src/last_update.json", "w", encoding="utf-8") as f:
            json.dump(update_info, f, ensure_ascii=False, indent=4)
        print(f"✅ موفقیت: {len(new_entries)} تجربه جدید اضافه شد.")
    else:
        print("--- تجربه جدیدی پیدا نشد ---")

if __name__ == "__main__":
    scrape_with_bot()
