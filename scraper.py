import json
import re
import os
import requests
import datetime

BOT_TOKEN = os.environ.get("BOT_TOKEN")
CHANNEL_ID = "@IAUCourseExp"
CLEAN_CH_ID = CHANNEL_ID.replace('@', '')
DATA_FILE = "src/data.json"
REPORT_CHAT_ID = os.environ.get("REPORT_CHAT_ID")
OFFSET_FILE = "src/last_offset.txt"


def clean_text(text):
    if not text:
        return ""
    return text.replace('#', '').replace('_', ' ').strip()


def parse_experience(message_text, msg_id):
    course_match = re.search(
        r"(?:📚|🟡)\s*(?:نام\s+)?درس\s*[:：]?\s*(.*?)(?=\n|🧮|🟢|🧑‍🏫|🔵|$)",
        message_text,
        re.DOTALL,
    )
    prof_match = re.search(
        r"(?:🧑‍🏫|🔵)\s*(?:نام\s+استاد\s+مربوطه|استاد)\s*[:：]?\s*(.*?)(?=\n|❓|💬|🔴|$)",
        message_text,
        re.DOTALL,
    )

    student_score = "?"
    student_score_match = re.search(
        r"(?:🧮|🟢)\s*(?:نمره|نمرتون)\s*[:：]?\s*(.*?)(?=\n|🧑‍🏫|🔵|❓|$)",
        message_text,
    )
    if student_score_match:
        scores = re.findall(r"(\d+(?:\.\d+)?)", student_score_match.group(1).strip())
        student_score = scores[0] if scores else "?"

    prof_score = "?"
    prof_field_area = re.search(
        r"❓\s*نمره ی شما به استاد.*?(?=\n\s*(?:💬|🔴|🆔|$))",
        message_text,
        re.DOTALL,
    )
    if prof_field_area:
        text_to_search = re.sub(r"\(.*?\d+.*?\d+.*?\)", "", prof_field_area.group(0))
        scores = re.findall(r"(\d+(?:\.\d+)?)", text_to_search)
        prof_score = scores[0] if scores else "?"

    text_match = re.search(
        r"(?:💬|🔴)\s*(?:تجربه\s+شما|دیدگاه\s+شما|نظرتون|نظر).*?[:：]\s*(.*?)(?=\n*-{5,}|\n*لطفا\s+از\s+طریق|$)",
        message_text,
        re.DOTALL,
    )

    if course_match and prof_match:
        return {
            "id": 0,
            "Link": f"https://t.me/{CLEAN_CH_ID}/{msg_id}",
            "course": " ".join(clean_text(course_match.group(1)).split()),
            "Student_Score": student_score,
            "Professor_Score": prof_score,
            "professor": prof_match.group(1).strip(),
            "text": (
                re.sub(
                    r"\n*❗️توجه❗️.*",
                    "",
                    text_match.group(1).strip(),
                    flags=re.DOTALL,
                )
                if text_match
                else "بدون متن"
            ),
        }
    return None


def send_telegram_report(status_msg):
    if not REPORT_CHAT_ID or not BOT_TOKEN:
        return
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    payload = {"chat_id": REPORT_CHAT_ID, "text": status_msg, "parse_mode": "HTML"}
    try:
        requests.post(url, json=payload, timeout=10)
    except Exception as e:
        print(f"❌ خطا در ارسال گزارش: {e}")


def load_offset():
    if os.path.exists(OFFSET_FILE):
        try:
            with open(OFFSET_FILE, "r", encoding="utf-8") as f:
                return int(f.read().strip())
        except (ValueError, IOError):
            return 0
    return 0


def save_offset(offset):
    try:
        with open(OFFSET_FILE, "w", encoding="utf-8") as f:
            f.write(str(offset))
    except IOError:
        print("⚠️ خطا در ذخیره فایل offset")


def scrape_with_bot():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            database = json.load(f)
    else:
        database = []

    existing_links = {item["Link"] for item in database}

    if database:
        current_max_id = max(item["id"] for item in database)
    else:
        current_max_id = 0

    all_updates = []
    last_update_id = load_offset() 

    print(f"🔄 شروع دریافت آپدیت‌ها از offset {last_update_id}")

    while True:
        url = (
            f"https://api.telegram.org/bot{BOT_TOKEN}/getUpdates"
            f"?offset={last_update_id + 1}&limit=100"
        )

        try:
            response = requests.get(url, timeout=10).json()
        except Exception as e:
            print(f"❌ خطای شبکه: {e}")
            return

        if not response.get("ok"):
            print(f"❌ خطا از سمت تلگرام: {response.get('description')}")
            return

        updates = response.get("result", [])
        if not updates:
            break

        all_updates.extend(updates)
        for upd in updates:
            if upd.get("update_id", 0) > last_update_id:
                last_update_id = upd["update_id"]

        print(f"📦 {len(updates)} آپدیت دریافت شد (مجموع: {len(all_updates)})")

        if len(updates) < 100:
            break

    if not all_updates:
        print("--- هیچ آپدیتی در کانال وجود ندارد ---")
        return

    print(f"✅ کل آپدیت‌های دریافت‌شده: {len(all_updates)}")

    all_updates.reverse()
    print("🔄 لیست آپدیت‌ها معکوس شد (از جدید به قدیم)")

    new_entries = []
    stop_at_first_duplicate = True  

    for update in all_updates:
        message = update.get("message") or update.get("channel_post")
        if not message:
            continue

        msg_id = message.get("message_id")
        msg_text = message.get("text", "")
        current_link = f"https://t.me/{CLEAN_CH_ID}/{msg_id}"

        if stop_at_first_duplicate and current_link in existing_links:
            print(f"🛑 به اولین لینک تکراری رسیدیم: {current_link} — متوقف شدیم")
            break

        if current_link not in existing_links:
            if any(indicator in msg_text for indicator in ["📚نام درس", "🟡درس"]):
                extracted = parse_experience(msg_text, msg_id)
                if extracted:
                    current_max_id += 1
                    extracted["id"] = current_max_id
                    new_entries.append(extracted)
                    existing_links.add(current_link)

    now = datetime.datetime.utcnow() + datetime.timedelta(hours=3, minutes=30)
    time_str = now.strftime("%Y/%m/%d - %H:%M")

    if new_entries:
        database.extend(new_entries)
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(database, f, ensure_ascii=False, indent=4)

        save_offset(last_update_id)

        with open("src/last_update.json", "w", encoding="utf-8") as f:
            json.dump({"last_update": time_str}, f, ensure_ascii=False, indent=4)

        print(f"✅ موفقیت: {len(new_entries)} تجربه جدید اضافه شد.")
    else:
        print("--- تجربه جدیدی پیدا نشد ---")
    

    report_text = (
        f"🤖 <b>گزارش خودکار اسکرپر</b>\n\n"
        f"📅 زمان اجرا: <code>{time_str}</code>\n"
        f"✅ وضعیت: {'تجربه جدید اضافه شد 📥' if new_entries else ' تجربه جدیدی نبود 😴 تجاربتون رو بفرستید به بات تجربیات | @IAUCourseExpBot '}\n"
        f"📥 تعداد جدید در این پارت: <b>{len(new_entries)}</b>\n"
        f"📊 کل تجربیات دیتابیس: <b>{len(database)}</b>\n\n"
        f"🔗 مشاهده سایت:\n https://IAUCourseExp.github.io/iau-experiences/"
    )

    send_telegram_report(report_text)


if __name__ == "__main__":
    scrape_with_bot()
