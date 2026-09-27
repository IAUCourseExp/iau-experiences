import json
import re
import os
import requests
import datetime
import sys
import traceback
from collections import Counter


# ============================================================
# ORIGINAL CONFIG — DO NOT CHANGE
# ============================================================

BOT_TOKEN = os.environ.get("BOT_TOKEN")
CHANNEL_ID = "@IAUCourseExp"
CLEAN_CH_ID = CHANNEL_ID.replace('@', '')
DATA_FILE = "src/data.json"
REPORT_CHAT_ID = os.environ.get("REPORT_CHAT_ID")


# ============================================================
# DEBUG CONFIG
# ============================================================

DEBUG = True

# Maximum characters of a Telegram message printed into Actions logs.
# Large enough to diagnose parsing, but avoids exploding the log size.
DEBUG_TEXT_PREVIEW = 2500

# Maximum number of individual updates for which we print detailed
# information. The API normally returns at most 100 anyway.
DEBUG_MAX_UPDATE_DETAILS = 100


# ============================================================
# DEBUG HELPERS
# ============================================================

def debug_header(title):
    if not DEBUG:
        return

    print("\n" + "=" * 110)
    print(f"🔬 {title}")
    print("=" * 110)


def debug_subheader(title):
    if not DEBUG:
        return

    print("\n" + "-" * 110)
    print(f"🔎 {title}")
    print("-" * 110)


def safe_preview(value, limit=DEBUG_TEXT_PREVIEW):
    if value is None:
        return ""

    value = str(value)

    if len(value) <= limit:
        return value

    return value[:limit] + f"\n... [TRUNCATED {len(value) - limit} chars]"


def safe_bot_token_info():
    if not BOT_TOKEN:
        return "MISSING"

    if len(BOT_TOKEN) <= 10:
        return "***"

    return (
        BOT_TOKEN[:5]
        + "..."
        + BOT_TOKEN[-5:]
    )


def utc_now_string():
    return datetime.datetime.utcnow().strftime(
        "%Y-%m-%d %H:%M:%S UTC"
    )


def local_now_string():
    now = datetime.datetime.utcnow() + datetime.timedelta(
        hours=3,
        minutes=30
    )

    return now.strftime("%Y/%m/%d - %H:%M")


# ============================================================
# ORIGINAL TEXT CLEANER — UNCHANGED
# ============================================================

def clean_text(text):
    if not text:
        return ""
    return text.replace('#', '').replace('_', ' ').strip()


# ============================================================
# ORIGINAL PARSER
#
# IMPORTANT:
# The original regex structures are intentionally preserved.
# Only diagnostic logging was added around them.
# ============================================================

def parse_experience(message_text, msg_id):

    debug_subheader(
        f"PARSER START — message_id={msg_id}"
    )

    print(
        f"📏 message_text length = {len(message_text or '')}"
    )

    print(
        f"📝 message_text preview:\n"
        f"{safe_preview(message_text)}"
    )

    # --------------------------------------------------------
    # ORIGINAL REGEX — DO NOT CHANGE
    # --------------------------------------------------------

    course_match = re.search(
        r"(?:📚|🟡)\s*(?:نام\s+)?درس\s*[:：]?\s*(.*?)(?=\n|🧮|🟢|🧑‍🏫|🔵|$)",
        message_text,
        re.DOTALL
    )

    prof_match = re.search(
        r"(?:🧑‍🏫|🔵)\s*(?:نام\s+استاد\s+مربوطه|استاد)\s*[:：]?\s*(.*?)(?=\n|❓|💬|🔴|$)",
        message_text,
        re.DOTALL
    )

    student_score = "?"

    student_score_match = re.search(
        r"(?:🧮|🟢)\s*(?:نمره|نمرتون)\s*[:：]?\s*(.*?)(?=\n|🧑‍🏫|🔵|❓|$)",
        message_text
    )

    if student_score_match:
        scores = re.findall(
            r"(\d+(?:\.\d+)?)",
            student_score_match.group(1).strip()
        )

        student_score = scores[0] if scores else "?"

    prof_score = "?"

    prof_field_area = re.search(
        r"❓\s*نمره ی شما به استاد.*?(?=\n\s*(?:💬|🔴|🆔|$))",
        message_text,
        re.DOTALL
    )

    if prof_field_area:
        text_to_search = re.sub(
            r"\(.*?\d+.*?\d+.*?\)",
            "",
            prof_field_area.group(0)
        )

        scores = re.findall(
            r"(\d+(?:\.\d+)?)",
            text_to_search
        )

        prof_score = scores[0] if scores else "?"

    text_match = re.search(
        r"(?:💬|🔴)\s*(?:تجربه\s+شما|دیدگاه\s+شما|نظرتون|نظر).*?[:：]\s*(.*?)(?=\n*-{5,}|\n*لطفا\s+از\s+طریق|$)",
        message_text,
        re.DOTALL
    )

    # --------------------------------------------------------
    # REGEX DIAGNOSTICS
    # --------------------------------------------------------

    print("\n🧬 REGEX RESULTS")

    print(
        f"course_match         = {bool(course_match)}"
    )

    if course_match:
        print(
            f"course raw            = "
            f"{repr(course_match.group(1))}"
        )
    else:
        print("❌ COURSE REGEX FAILED")

    print(
        f"prof_match            = {bool(prof_match)}"
    )

    if prof_match:
        print(
            f"professor raw         = "
            f"{repr(prof_match.group(1))}"
        )
    else:
        print("❌ PROFESSOR REGEX FAILED")

    print(
        f"student_score_match   = "
        f"{bool(student_score_match)}"
    )

    print(
        f"student_score         = "
        f"{student_score}"
    )

    print(
        f"prof_field_area       = "
        f"{bool(prof_field_area)}"
    )

    print(
        f"professor_score       = "
        f"{prof_score}"
    )

    print(
        f"text_match            = "
        f"{bool(text_match)}"
    )

    if text_match:
        print(
            f"experience text       = "
            f"{repr(safe_preview(text_match.group(1), 800))}"
        )
    else:
        print(
            "⚠️ EXPERIENCE TEXT REGEX DID NOT MATCH"
        )

    # --------------------------------------------------------
    # ORIGINAL ACCEPTANCE LOGIC — UNCHANGED
    # --------------------------------------------------------

    if course_match and prof_match:

        extracted = {
            "id": 0,
            "Link": f"https://t.me/{CLEAN_CH_ID}/{msg_id}",
            "course": ' '.join(
                clean_text(
                    course_match.group(1)
                ).split()
            ),
            "Student_Score": student_score,
            "Professor_Score": prof_score,
            "professor": prof_match.group(1).strip(),
            "text": re.sub(
                r"\n*❗️توجه❗️.*",
                "",
                text_match.group(1).strip(),
                flags=re.DOTALL
            ) if text_match else "بدون متن"
        }

        print("\n✅ PARSER ACCEPTED MESSAGE")

        print(
            json.dumps(
                extracted,
                ensure_ascii=False,
                indent=2
            )
        )

        print(
            f"🔗 Generated link = "
            f"{extracted['Link']}"
        )

        return extracted

    print("\n❌ PARSER REJECTED MESSAGE")

    if not course_match:
        print(
            "   Reason: course_match == False"
        )

    if not prof_match:
        print(
            "   Reason: prof_match == False"
        )

    return None


# ============================================================
# ORIGINAL TELEGRAM REPORT FUNCTION
# ============================================================

def send_telegram_report(status_msg):

    if not REPORT_CHAT_ID or not BOT_TOKEN:
        print(
            "⚠️ REPORT_CHAT_ID or BOT_TOKEN missing; "
            "Telegram report will NOT be sent."
        )
        return

    url = (
        f"https://api.telegram.org/"
        f"bot{BOT_TOKEN}/sendMessage"
    )

    payload = {
        "chat_id": REPORT_CHAT_ID,
        "text": status_msg,
        "parse_mode": "HTML"
    }

    try:

        response = requests.post(
            url,
            json=payload,
            timeout=10
        )

        print("\n📤 TELEGRAM REPORT RESULT")

        print(
            f"HTTP status = {response.status_code}"
        )

        try:
            report_response = response.json()

            print(
                f"Telegram ok = "
                f"{report_response.get('ok')}"
            )

            if not report_response.get("ok"):
                print(
                    f"Telegram error = "
                    f"{report_response.get('description')}"
                )

        except Exception:
            print(
                "⚠️ Could not parse Telegram report response"
            )

    except Exception as e:

        print(
            f"❌ خطا در ارسال گزارش: {e}"
        )

        print(
            traceback.format_exc()
        )


# ============================================================
# READ-ONLY TELEGRAM DIAGNOSTICS
# ============================================================

def telegram_readonly_diagnostics():

    debug_header(
        "TELEGRAM BOT / CHANNEL READ-ONLY DIAGNOSTICS"
    )

    print(
        f"🕐 Diagnostics time: "
        f"{utc_now_string()}"
    )

    print(
        f"🐍 Python: "
        f"{sys.version.replace(chr(10), ' ')}"
    )

    print(
        f"📂 Working directory: "
        f"{os.getcwd()}"
    )

    print(
        f"🤖 BOT_TOKEN present: "
        f"{bool(BOT_TOKEN)}"
    )

    print(
        f"🔐 BOT_TOKEN fingerprint: "
        f"{safe_bot_token_info()}"
    )

    print(
        f"📢 CHANNEL_ID: "
        f"{CHANNEL_ID}"
    )

    print(
        f"🧹 CLEAN_CH_ID: "
        f"{CLEAN_CH_ID}"
    )

    print(
        f"📊 DATA_FILE: "
        f"{DATA_FILE}"
    )

    print(
        f"👥 REPORT_CHAT_ID present: "
        f"{bool(REPORT_CHAT_ID)}"
    )

    if not BOT_TOKEN:
        print(
            "❌ BOT_TOKEN is missing. "
            "Telegram diagnostics cannot continue."
        )
        return

    base_url = (
        f"https://api.telegram.org/"
        f"bot{BOT_TOKEN}"
    )

    # --------------------------------------------------------
    # getMe
    # --------------------------------------------------------

    debug_subheader(
        "getMe()"
    )

    try:

        response = requests.get(
            f"{base_url}/getMe",
            timeout=10
        )

        print(
            f"HTTP status = {response.status_code}"
        )

        data = response.json()

        print(
            f"ok = {data.get('ok')}"
        )

        if data.get("ok"):

            bot = data.get("result", {})

            print(
                f"bot.id = "
                f"{bot.get('id')}"
            )

            print(
                f"bot.is_bot = "
                f"{bot.get('is_bot')}"
            )

            print(
                f"bot.first_name = "
                f"{bot.get('first_name')}"
            )

            print(
                f"bot.username = "
                f"@{bot.get('username')}"
            )

        else:

            print(
                f"❌ Telegram error = "
                f"{data.get('description')}"
            )

    except Exception as e:

        print(
            f"❌ getMe exception = {e}"
        )

    # --------------------------------------------------------
    # getWebhookInfo
    # --------------------------------------------------------

    debug_subheader(
        "getWebhookInfo()"
    )

    try:

        response = requests.get(
            f"{base_url}/getWebhookInfo",
            timeout=10
        )

        print(
            f"HTTP status = {response.status_code}"
        )

        data = response.json()

        print(
            f"ok = {data.get('ok')}"
        )

        if data.get("ok"):

            info = data.get("result", {})

            webhook_url = info.get("url", "")

            print(
                f"webhook configured = "
                f"{bool(webhook_url)}"
            )

            print(
                f"pending_update_count = "
                f"{info.get('pending_update_count')}"
            )

            print(
                f"max_connections = "
                f"{info.get('max_connections')}"
            )

            print(
                f"ip_address = "
                f"{info.get('ip_address')}"
            )

            print(
                f"last_error_date = "
                f"{info.get('last_error_date')}"
            )

            print(
                f"last_error_message = "
                f"{info.get('last_error_message')}"
            )

            # DO NOT print actual webhook URL because it can
            # contain a secret path/token.
            if webhook_url:
                print(
                    "⚠️ WEBHOOK URL EXISTS "
                    "(URL intentionally hidden from logs)"
                )
            else:
                print(
                    "✅ No webhook URL configured."
                )

        else:

            print(
                f"❌ Telegram error = "
                f"{data.get('description')}"
            )

    except Exception as e:

        print(
            f"❌ getWebhookInfo exception = {e}"
        )

    # --------------------------------------------------------
    # getChat
    # --------------------------------------------------------

    debug_subheader(
        f"getChat({CHANNEL_ID})"
    )

    try:

        response = requests.get(
            f"{base_url}/getChat",
            params={
                "chat_id": CHANNEL_ID
            },
            timeout=10
        )

        print(
            f"HTTP status = {response.status_code}"
        )

        data = response.json()

        print(
            f"ok = {data.get('ok')}"
        )

        if data.get("ok"):

            chat = data.get("result", {})

            print(
                f"chat.id = "
                f"{chat.get('id')}"
            )

            print(
                f"chat.type = "
                f"{chat.get('type')}"
            )

            print(
                f"chat.title = "
                f"{chat.get('title')}"
            )

            print(
                f"chat.username = "
                f"{chat.get('username')}"
            )

            print(
                f"chat.is_forum = "
                f"{chat.get('is_forum')}"
            )

        else:

            print(
                f"❌ Telegram error = "
                f"{data.get('description')}"
            )

    except Exception as e:

        print(
            f"❌ getChat exception = {e}"
        )


# ============================================================
# MAIN SCRAPER
#
# Existing processing logic is intentionally preserved.
# ============================================================

def scrape_with_bot():

    debug_header(
        "START SCRAPER DIAGNOSTIC RUN"
    )

    print(
        f"🕐 Start UTC: {utc_now_string()}"
    )

    print(
        f"🕐 Start local: {local_now_string()}"
    )

    # --------------------------------------------------------
    # EXISTING DATABASE LOAD
    # --------------------------------------------------------

    debug_subheader(
        "DATABASE STATE BEFORE SCRAPING"
    )

    last_update_id = 0

    if os.path.exists(DATA_FILE):

        print(
            f"✅ DATA_FILE exists: {DATA_FILE}"
        )

        try:

            with open(
                DATA_FILE,
                'r',
                encoding='utf-8'
            ) as f:

                database = json.load(f)

            print(
                f"✅ JSON loaded successfully."
            )

            print(
                f"📊 Database item count = "
                f"{len(database)}"
            )

        except Exception as e:

            print(
                f"❌ ERROR loading database: {e}"
            )

            print(
                traceback.format_exc()
            )

            raise

    else:

        print(
            f"⚠️ DATA_FILE DOES NOT EXIST: "
            f"{DATA_FILE}"
        )

        database = []

    existing_links = {
        item['Link']
        for item in database
        if 'Link' in item
    }

    print(
        f"🔗 existing_links count = "
        f"{len(existing_links)}"
    )

    if database:

        try:

            current_max_id = max(
                item['id']
                for item in database
            )

        except Exception as e:

            print(
                f"❌ Could not determine current max id: {e}"
            )

            raise

    else:

        current_max_id = 0

    print(
        f"🔢 current_max_id = "
        f"{current_max_id}"
    )

    # --------------------------------------------------------
    # TELEGRAM READ-ONLY DIAGNOSTICS
    # --------------------------------------------------------

    telegram_readonly_diagnostics()

    # --------------------------------------------------------
    # EXISTING getUpdates API
    #
    # IMPORTANT:
    # Same endpoint.
    # Same BOT_TOKEN.
    # No changed parser.
    # No allowed_updates change.
    # --------------------------------------------------------

    debug_header(
        "GETUPDATES"
    )

    url = (
        f"https://api.telegram.org/"
        f"bot{BOT_TOKEN}/getUpdates"
    )

    print(
        "📡 Calling Telegram getUpdates..."
    )

    print(
        "⚠️ IMPORTANT: This diagnostic version "
        "keeps the original getUpdates call behavior."
    )

    print(
        f"Endpoint: "
        f"https://api.telegram.org/bot<REDACTED>/getUpdates"
    )

    request_started = datetime.datetime.utcnow()

    try:

        raw_response = requests.get(
            url,
            timeout=10
        )

        request_finished = datetime.datetime.utcnow()

        print(
            f"⏱️ HTTP request duration = "
            f"{(request_finished - request_started).total_seconds():.3f}s"
        )

        print(
            f"🌐 HTTP status code = "
            f"{raw_response.status_code}"
        )

        print(
            f"📦 Response bytes = "
            f"{len(raw_response.content)}"
        )

        try:

            response = raw_response.json()

        except Exception as e:

            print(
                f"❌ Response is NOT valid JSON: {e}"
            )

            print(
                "RAW RESPONSE PREVIEW:"
            )

            print(
                safe_preview(
                    raw_response.text,
                    5000
                )
            )

            raise

    except Exception as e:

        print(
            "❌ خطای شبکه (احتمالا پروکسی روشن نیست): "
            f"{e}"
        )

        print(
            traceback.format_exc()
        )

        return

    # --------------------------------------------------------
    # TELEGRAM RESPONSE
    # --------------------------------------------------------

    debug_header(
        "RAW GETUPDATES RESPONSE"
    )

    print(
        f"Telegram ok = "
        f"{response.get('ok')}"
    )

    print(
        f"Telegram error_code = "
        f"{response.get('error_code')}"
    )

    print(
        f"Telegram description = "
        f"{response.get('description')}"
    )

    if not response.get("ok"):

        print(
            "❌ Telegram getUpdates failed."
        )

        print(
            "⚠️ NO UPDATE ACK WILL BE ATTEMPTED."
        )

        return

    updates = response.get(
        "result",
        []
    )

    print(
        f"📦 TOTAL UPDATES RECEIVED = "
        f"{len(updates)}"
    )

    if not updates:

        print(
            "⚠️ Telegram returned ZERO updates."
        )

        print(
            "Possible diagnosis targets:"
        )

        print(
            "  1) No pending updates for this bot"
        )

        print(
            "  2) Webhook/update delivery state"
        )

        print(
            "  3) Wrong bot token"
        )

        print(
            "  4) Channel posts are not being delivered "
            "as channel_post"
        )

        print(
            "  5) The messages are already acknowledged"
        )

    else:

        first_update_id = updates[0].get(
            "update_id"
        )

        last_received_update_id = updates[-1].get(
            "update_id"
        )

        print(
            f"FIRST update_id = "
            f"{first_update_id}"
        )

        print(
            f"LAST update_id = "
            f"{last_received_update_id}"
        )

        print(
            f"UPDATE_ID RANGE = "
            f"{last_received_update_id - first_update_id + 1}"
        )

        print(
            f"NUMBER OF UPDATES = "
            f"{len(updates)}"
        )

        if (
            len(updates) == 100
            and
            last_received_update_id - first_update_id + 1 >= 100
        ):
            print(
                "⚠️ EXACT/MAX BATCH DETECTED: "
                "Telegram returned 100 updates."
            )

            print(
                "This means the queue may contain "
                "MORE updates after this batch."
            )

    # --------------------------------------------------------
    # DETAILED UPDATE ANALYSIS
    # --------------------------------------------------------

    debug_header(
        "UPDATE-BY-UPDATE ANALYSIS"
    )

    type_counter = Counter()

    channel_post_count = 0
    edited_channel_post_count = 0
    message_count = 0
    callback_query_count = 0
    other_update_count = 0

    channel_message_ids = []

    channel_message_dates = []

    parser_candidate_count = 0
    duplicate_count = 0
    parser_rejected_count = 0
    accepted_count = 0

    mismatched_channel_count = 0

    for index, update in enumerate(
        updates,
        start=1
    ):

        update_id = update.get(
            "update_id"
        )

        update_keys = [
            key
            for key in update.keys()
            if key != "update_id"
        ]

        for key in update_keys:
            type_counter[key] += 1

        print("\n" + "-" * 110)

        print(
            f"UPDATE #{index}/{len(updates)}"
        )

        print(
            f"update_id = {update_id}"
        )

        print(
            f"update types = {update_keys}"
        )

        # ----------------------------------------------------
        # CHANNEL POST
        # ----------------------------------------------------

        if "channel_post" in update:

            channel_post_count += 1

            message = update.get(
                "channel_post"
            )

            if not message:
                print(
                    "⚠️ channel_post key exists "
                    "but object is empty."
                )

                continue

            msg_id = message.get(
                "message_id"
            )

            channel_message_ids.append(
                msg_id
            )

            msg_date = message.get(
                "date"
            )

            channel_message_dates.append(
                msg_date
            )

            chat = message.get(
                "chat",
                {}
            )

            chat_id = chat.get(
                "id"
            )

            chat_type = chat.get(
                "type"
            )

            chat_username = chat.get(
                "username"
            )

            chat_title = chat.get(
                "title"
            )

            print(
                "✅ THIS IS A channel_post"
            )

            print(
                f"Telegram update_id = "
                f"{update_id}"
            )

            print(
                f"Telegram message_id = "
                f"{msg_id}"
            )

            print(
                f"chat.id = "
                f"{chat_id}"
            )

            print(
                f"chat.type = "
                f"{chat_type}"
            )

            print(
                f"chat.username = "
                f"{chat_username}"
            )

            print(
                f"chat.title = "
                f"{chat_title}"
            )

            print(
                f"channel expected username = "
                f"{CLEAN_CH_ID}"
            )

            # Check whether this update actually belongs
            # to our target channel.
            username_matches = (
                chat_username == CLEAN_CH_ID
            )

            if username_matches:

                print(
                    "✅ CHANNEL USERNAME MATCHES"
                )

            else:

                mismatched_channel_count += 1

                print(
                    "⚠️ CHANNEL USERNAME DOES NOT MATCH"
                )

            print(
                f"message.date = "
                f"{msg_date}"
            )

            print(
                f"has text = "
                f"{bool(message.get('text'))}"
            )

            print(
                f"has caption = "
                f"{bool(message.get('caption'))}"
            )

            msg_text = message.get(
                "text",
                ""
            )

            if not msg_text:

                msg_text = message.get(
                    "caption",
                    ""
                )

            print(
                f"text length = "
                f"{len(msg_text)}"
            )

            print(
                "TEXT PREVIEW:"
            )

            print(
                safe_preview(msg_text)
            )

            current_link = (
                f"https://t.me/"
                f"{CLEAN_CH_ID}/"
                f"{msg_id}"
            )

            print(
                f"generated current_link = "
                f"{current_link}"
            )

            # ------------------------------------------------
            # DUPLICATE CHECK — ORIGINAL LOGIC
            # ------------------------------------------------

            if current_link in existing_links:

                duplicate_count += 1

                print(
                    "♻️ DUPLICATE DETECTED"
                )

                print(
                    "This message's Link already "
                    "exists in data.json."
                )

                continue

            print(
                "🆕 LINK IS NOT IN DATABASE"
            )

            # ------------------------------------------------
            # EXISTING INDICATOR CHECK
            # ------------------------------------------------

            has_experience_indicator = any(
                indicator in msg_text
                for indicator in [
                    "📚نام درس",
                    "🟡درس"
                ]
            )

            print(
                f"experience indicator match = "
                f"{has_experience_indicator}"
            )

            if not has_experience_indicator:

                print(
                    "⚠️ Message is NOT considered "
                    "an experience candidate."
                )

                print(
                    "Required indicators:"
                )

                print(
                    "  📚نام درس"
                )

                print(
                    "  🟡درس"
                )

                continue

            parser_candidate_count += 1

            print(
                "✅ MESSAGE PASSED EXPERIENCE INDICATOR"
            )

            # ------------------------------------------------
            # EXACT ORIGINAL PARSER
            # ------------------------------------------------

            extracted = parse_experience(
                msg_text,
                msg_id
            )

            if extracted:

                accepted_count += 1

                current_max_id += 1

                extracted["id"] = current_max_id

                new_entries.append(
                    extracted
                )

                existing_links.add(
                    current_link
                )

                print(
                    "\n🎉 NEW ENTRY ACCEPTED"
                )

                print(
                    f"assigned database id = "
                    f"{current_max_id}"
                )

            else:

                parser_rejected_count += 1

                print(
                    "\n❌ MESSAGE REJECTED BY PARSER"
                )

        # ----------------------------------------------------
        # EDITED CHANNEL POST
        # ----------------------------------------------------

        elif "edited_channel_post" in update:

            edited_channel_post_count += 1

            message = update.get(
                "edited_channel_post"
            )

            print(
                "⚠️ EDITED_CHANNEL_POST"
            )

            if message:

                print(
                    f"message_id = "
                    f"{message.get('message_id')}"
                )

                chat = message.get(
                    "chat",
                    {}
                )

                print(
                    f"chat.id = "
                    f"{chat.get('id')}"
                )

                print(
                    f"chat.username = "
                    f"{chat.get('username')}"
                )

            print(
                "IMPORTANT: Existing scraper "
                "does NOT process edited_channel_post."
            )

        # ----------------------------------------------------
        # NORMAL MESSAGE
        # ----------------------------------------------------

        elif "message" in update:

            message_count += 1

            message = update.get(
                "message"
            )

            print(
                "⚠️ NORMAL 'message' UPDATE"
            )

            if message:

                chat = message.get(
                    "chat",
                    {}
                )

                print(
                    f"message_id = "
                    f"{message.get('message_id')}"
                )

                print(
                    f"chat.id = "
                    f"{chat.get('id')}"
                )

                print(
                    f"chat.type = "
                    f"{chat.get('type')}"
                )

                print(
                    f"chat.username = "
                    f"{chat.get('username')}"
                )

                print(
                    f"chat.title = "
                    f"{chat.get('title')}"
                )

                print(
                    "This update is intentionally ignored "
                    "by the scraper."
                )

        # ----------------------------------------------------
        # CALLBACK
        # ----------------------------------------------------

        elif "callback_query" in update:

            callback_query_count += 1

            print(
                "⚠️ CALLBACK_QUERY UPDATE"
            )

            callback = update.get(
                "callback_query",
                {}
            )

            print(
                f"callback id = "
                f"{callback.get('id')}"
            )

            sender = callback.get(
                "from",
                {}
            )

            print(
                f"from.id = "
                f"{sender.get('id')}"
            )

            print(
                "This update is ignored by scraper."
            )

        # ----------------------------------------------------
        # OTHER
        # ----------------------------------------------------

        else:

            other_update_count += 1

            print(
                "⚠️ UNKNOWN / OTHER UPDATE"
            )

            print(
                f"keys = {update_keys}"
            )

            # Don't print potentially huge raw object.
            print(
                "update preview = "
                + safe_preview(
                    json.dumps(
                        update,
                        ensure_ascii=False
                    ),
                    3000
                )
            )

    # ========================================================
    # UPDATE SUMMARY
    # ========================================================

    debug_header(
        "UPDATE QUEUE SUMMARY"
    )

    print(
        f"TOTAL UPDATES RECEIVED       = "
        f"{len(updates)}"
    )

    print(
        f"CHANNEL_POST                 = "
        f"{channel_post_count}"
    )

    print(
        f"EDITED_CHANNEL_POST          = "
        f"{edited_channel_post_count}"
    )

    print(
        f"NORMAL MESSAGE               = "
        f"{message_count}"
    )

    print(
        f"CALLBACK_QUERY               = "
        f"{callback_query_count}"
    )

    print(
        f"OTHER UPDATE TYPES          = "
        f"{other_update_count}"
    )

    print(
        f"CHANNEL MISMATCHES           = "
        f"{mismatched_channel_count}"
    )

    print(
        f"EXPERIENCE CANDIDATES        = "
        f"{parser_candidate_count}"
    )

    print(
        f"DUPLICATES                   = "
        f"{duplicate_count}"
    )

    print(
        f"PARSER REJECTED              = "
        f"{parser_rejected_count}"
    )

    print(
        f"NEW ENTRIES ACCEPTED         = "
        f"{accepted_count}"
    )

    print(
        "\nUPDATE TYPE COUNTS:"
    )

    for key, count in type_counter.items():

        print(
            f"  {key}: {count}"
        )

    # --------------------------------------------------------
    # MESSAGE ID RANGE
    # --------------------------------------------------------

    debug_subheader(
        "CHANNEL MESSAGE ID ANALYSIS"
    )

    if channel_message_ids:

        print(
            f"Channel posts received = "
            f"{len(channel_message_ids)}"
        )

        print(
            f"FIRST channel message_id = "
            f"{channel_message_ids[0]}"
        )

        print(
            f"LAST channel message_id = "
            f"{channel_message_ids[-1]}"
        )

        print(
            "ALL channel message IDs:"
        )

        print(
            channel_message_ids
        )

        if len(channel_message_ids) >= 2:

            differences = [
                b - a
                for a, b in zip(
                    channel_message_ids,
                    channel_message_ids[1:]
                )
                if isinstance(a, int)
                and isinstance(b, int)
            ]

            print(
                f"Message ID differences = "
                f"{differences[:100]}"
            )

    else:

        print(
            "❌ NO channel message IDs "
            "were received in this batch."
        )

    # ========================================================
    # ORIGINAL ACKNOWLEDGEMENT LOGIC
    # ========================================================

    debug_header(
        "TELEGRAM UPDATE ACKNOWLEDGEMENT"
    )

    if last_update_id > 0:

        print(
            f"LAST UPDATE ID TO ACK = "
            f"{last_update_id}"
        )

        print(
            f"ACK OFFSET = "
            f"{last_update_id + 1}"
        )

        print(
            "⚠️ This is Telegram update_id."
        )

        print(
            "⚠️ It is NOT the channel message_id."
        )

        try:

            ack_response = requests.get(
                f"https://api.telegram.org/"
                f"bot{BOT_TOKEN}/getUpdates"
                f"?offset={last_update_id + 1}",
                timeout=5
            )

            print(
                f"ACK HTTP status = "
                f"{ack_response.status_code}"
            )

            try:

                ack_json = ack_response.json()

                print(
                    f"ACK Telegram ok = "
                    f"{ack_json.get('ok')}"
                )

                print(
                    f"ACK returned result count = "
                    f"{len(ack_json.get('result', []))}"
                )

                if not ack_json.get("ok"):

                    print(
                        f"⚠️ ACK Telegram error = "
                        f"{ack_json.get('description')}"
                    )

            except Exception as e:

                print(
                    f"⚠️ ACK response JSON parse error: {e}"
                )

            print(
                f"--- آپدیت‌ها تا آی‌دی "
                f"{last_update_id} تایید شدند ---"
            )

        except Exception as e:

            print(
                f"⚠️ خطای کوچک در تایید آپدیت‌ها "
                f"به تلگرام: {e}"
            )

            print(
                traceback.format_exc()
            )

    else:

        print(
            "ℹ️ No update_id available, "
            "so no ACK was attempted."
        )

    # ========================================================
    # ORIGINAL DATABASE WRITE LOGIC
    # ========================================================

    debug_header(
        "DATABASE WRITE"
    )

    now = datetime.datetime.utcnow() + datetime.timedelta(
        hours=3,
        minutes=30
    )

    time_str = now.strftime(
        "%Y/%m/%d - %H:%M"
    )

    print(
        f"Execution time_str = "
        f"{time_str}"
    )

    print(
        f"new_entries count = "
        f"{len(new_entries)}"
    )

    if new_entries:

        print(
            "✅ NEW ENTRIES EXIST."
        )

        print(
            "Preparing to append them to database..."
        )

        for i, entry in enumerate(
            new_entries,
            start=1
        ):

            print(
                f"\nNEW ENTRY #{i}"
            )

            print(
                json.dumps(
                    entry,
                    ensure_ascii=False,
                    indent=2
                )
            )

        database.extend(
            new_entries
        )

        with open(
            DATA_FILE,
            'w',
            encoding='utf-8'
        ) as f:

            json.dump(
                database,
                f,
                ensure_ascii=False,
                indent=4
            )

        print(
            f"✅ data.json written successfully."
        )

        print(
            f"📊 New database length = "
            f"{len(database)}"
        )

        update_info = {
            "last_update": time_str
        }

        with open(
            "src/last_update.json",
            "w",
            encoding="utf-8"
        ) as f:

            json.dump(
                update_info,
                f,
                ensure_ascii=False,
                indent=4
            )

        print(
            "✅ src/last_update.json written successfully."
        )

        print(
            f"✅ موفقیت: "
            f"{len(new_entries)} تجربه جدید اضافه شد."
        )

    else:

        print(
            "--- تجربه جدیدی پیدا نشد ---"
        )

        print(
            "⚠️ IMPORTANT DIAGNOSTIC:"
        )

        print(
            f"channel_post_count = "
            f"{channel_post_count}"
        )

        print(
            f"experience candidates = "
            f"{parser_candidate_count}"
        )

        print(
            f"duplicates = "
            f"{duplicate_count}"
        )

        print(
            f"parser rejected = "
            f"{parser_rejected_count}"
        )

        print(
            f"accepted = "
            f"{accepted_count}"
        )

    # ========================================================
    # ORIGINAL REPORT
    # ========================================================

    debug_header(
        "TELEGRAM REPORT"
    )

    report_text = (
        f"🤖 <b>گزارش خودکار اسکرپر</b>\n\n"
        f"📅 زمان اجرا: <code>{time_str}</code>\n"
        f"✅ وضعیت: "
        f"{'تجربه جدید اضافه شد 📥' if new_entries else ' تجربه جدیدی نبود 😴 تجاربتون رو بفرستید به بات تجربیات | @IAUCourseExpBot '}\n"
        f"📥 تعداد جدید در این پارت: <b>{len(new_entries)}</b>\n"
        f"📊 کل تجربیات دیتابیس: <b>{len(database)}</b>\n\n"
        f"🔗 مشاهده سایت:\n"
        f" https://IAUCourseExp.github.io/iau-experiences/"
    )

    send_telegram_report(
        report_text
    )

    # ========================================================
    # FINAL SUMMARY
    # ========================================================

    debug_header(
        "FINAL RUN SUMMARY"
    )

    print(
        f"Updates received          : {len(updates)}"
    )

    print(
        f"Channel posts             : {channel_post_count}"
    )

    print(
        f"Edited channel posts      : {edited_channel_post_count}"
    )

    print(
        f"Normal messages           : {message_count}"
    )

    print(
        f"Other updates             : {other_update_count}"
    )

    print(
        f"Experience candidates     : {parser_candidate_count}"
    )

    print(
        f"Duplicates                : {duplicate_count}"
    )

    print(
        f"Parser rejected           : {parser_rejected_count}"
    )

    print(
        f"Accepted new entries      : {accepted_count}"
    )

    print(
        f"Database final length     : {len(database)}"
    )

    print(
        f"Last update_id seen       : {last_update_id}"
    )

    if channel_message_ids:

        print(
            f"First channel message_id : "
            f"{channel_message_ids[0]}"
        )

        print(
            f"Last channel message_id  : "
            f"{channel_message_ids[-1]}"
        )

    else:

        print(
            "First channel message_id : NONE"
        )

        print(
            "Last channel message_id  : NONE"
        )

    print(
        f"Finished UTC              : "
        f"{utc_now_string()}"
    )

    print(
        "=" * 110
    )

    print(
        "🏁 SCRAPER DIAGNOSTIC RUN FINISHED"
    )

    print(
        "=" * 110
    )


# ============================================================
# ENTRY POINT
# ============================================================

if __name__ == "__main__":

    try:

        scrape_with_bot()

    except Exception as e:

        print("\n" + "!" * 110)

        print(
            "💥 UNHANDLED FATAL EXCEPTION"
        )

        print(
            f"Exception type: "
            f"{type(e).__name__}"
        )

        print(
            f"Exception: "
            f"{e}"
        )

        print(
            "\nFULL TRACEBACK:"
        )

        print(
            traceback.format_exc()
        )

        print(
            "!" * 110
        )

        raise
