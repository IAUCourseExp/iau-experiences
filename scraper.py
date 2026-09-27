import json
import re
import os
import sys
import time
import traceback
import tempfile
import datetime
import requests


# ============================================================
# CONFIG
# ============================================================

BOT_TOKEN = os.environ.get("BOT_TOKEN")
CHANNEL_ID = "@IAUCourseExp"
CLEAN_CH_ID = CHANNEL_ID.replace('@', '')
DATA_FILE = "src/data.json"
REPORT_CHAT_ID = os.environ.get("REPORT_CHAT_ID")

# Telegram / scraper behavior
BATCH_LIMIT = 100
MAX_BATCHES_PER_RUN = 50
HTTP_TIMEOUT = 15
REQUEST_RETRIES = 3
RETRY_BASE_SECONDS = 1.5
BETWEEN_BATCHES_SECONDS = 0.15

# Telegram update filtering
ALLOWED_UPDATES = ["channel_post"]

# Logging
DEBUG_TEXT_LIMIT = 2000
PRINT_EVERY_UPDATE = True


# ============================================================
# LOGGING
# ============================================================

def log(message=""):
    print(message, flush=True)


def section(title):
    log()
    log("=" * 110)
    log(title)
    log("=" * 110)


def subsection(title):
    log()
    log("-" * 110)
    log(title)
    log("-" * 110)


def safe_preview(text, limit=DEBUG_TEXT_LIMIT):
    if text is None:
        return ""

    text = str(text)

    if len(text) <= limit:
        return text

    return (
        text[:limit]
        + f"\n... [TRUNCATED {len(text) - limit} chars]"
    )


def utc_now():
    return datetime.datetime.now(
        datetime.timezone.utc
    )


def iran_now():
    return utc_now() + datetime.timedelta(
        hours=3,
        minutes=30
    )


def iran_time_string():
    return iran_now().strftime(
        "%Y/%m/%d - %H:%M"
    )


# ============================================================
# TEXT CLEANING
# ============================================================

def clean_text(text):
    if not text:
        return ""
    return text.replace('#', '').replace('_', ' ').strip()


# ============================================================
# ORIGINAL PARSER
# Regex structure preserved
# Database keys preserved
# ============================================================

def parse_experience(message_text, msg_id):

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

        student_score = (
            scores[0]
            if scores
            else "?"
        )

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

        prof_score = (
            scores[0]
            if scores
            else "?"
        )

    text_match = re.search(
        r"(?:💬|🔴)\s*(?:تجربه\s+شما|دیدگاه\s+شما|نظرتون|نظر).*?[:：]\s*(.*?)(?=\n*-{5,}|\n*لطفا\s+از\s+طریق|$)",
        message_text,
        re.DOTALL
    )

    if course_match and prof_match:

        return {
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
            "text": (
                re.sub(
                    r"\n*❗️توجه❗️.*",
                    "",
                    text_match.group(1).strip(),
                    flags=re.DOTALL
                )
                if text_match
                else "بدون متن"
            )
        }

    return None


# ============================================================
# TELEGRAM API
# ============================================================

class TelegramAPIError(Exception):
    pass


class TelegramAPI:

    def __init__(self, token):

        self.token = token

        self.base_url = (
            "https://api.telegram.org/"
            f"bot{self.token}"
        )

        self.session = requests.Session()

    def request(self, method, params=None):

        params = params or {}

        last_exception = None

        for attempt in range(
            1,
            REQUEST_RETRIES + 1
        ):

            try:

                response = self.session.get(
                    f"{self.base_url}/{method}",
                    params=params,
                    timeout=HTTP_TIMEOUT
                )

                status_code = response.status_code

                try:
                    payload = response.json()
                except Exception:
                    payload = None

                if status_code == 429:

                    retry_after = (
                        payload
                        .get("parameters", {})
                        .get("retry_after", 3)
                        if isinstance(payload, dict)
                        else 3
                    )

                    log(
                        f"⚠️ Telegram 429 on {method}; "
                        f"sleeping {retry_after}s"
                    )

                    time.sleep(
                        max(
                            1,
                            int(retry_after)
                        )
                    )

                    continue

                if status_code >= 500:

                    log(
                        f"⚠️ Telegram HTTP {status_code} "
                        f"on {method}; attempt "
                        f"{attempt}/{REQUEST_RETRIES}"
                    )

                    time.sleep(
                        RETRY_BASE_SECONDS * attempt
                    )

                    continue

                if not isinstance(payload, dict):

                    raise TelegramAPIError(
                        f"Invalid JSON response from {method}: "
                        f"{safe_preview(response.text, 1000)}"
                    )

                if not payload.get("ok"):

                    description = payload.get(
                        "description",
                        "Unknown Telegram error"
                    )

                    raise TelegramAPIError(
                        f"{method}: "
                        f"HTTP={status_code}; "
                        f"error={description}"
                    )

                return payload

            except (
                requests.Timeout,
                requests.ConnectionError,
                requests.RequestException,
            ) as exc:

                last_exception = exc

                log(
                    f"⚠️ Network error on {method}; "
                    f"attempt {attempt}/{REQUEST_RETRIES}: "
                    f"{exc}"
                )

                if attempt < REQUEST_RETRIES:

                    time.sleep(
                        RETRY_BASE_SECONDS * attempt
                    )

            except TelegramAPIError:
                raise

            except Exception as exc:

                last_exception = exc

                log(
                    f"⚠️ Unexpected API error on {method}; "
                    f"attempt {attempt}/{REQUEST_RETRIES}: "
                    f"{exc}"
                )

                if attempt < REQUEST_RETRIES:

                    time.sleep(
                        RETRY_BASE_SECONDS * attempt
                    )

        raise TelegramAPIError(
            f"{method} failed after "
            f"{REQUEST_RETRIES} attempts: "
            f"{last_exception}"
        )

    def get_me(self):

        return self.request(
            "getMe"
        )["result"]

    def get_webhook_info(self):

        return self.request(
            "getWebhookInfo"
        )["result"]

    def get_chat(self, chat_id):

        return self.request(
            "getChat",
            {
                "chat_id": chat_id
            }
        )["result"]

    def get_chat_member(
        self,
        chat_id,
        user_id
    ):

        return self.request(
            "getChatMember",
            {
                "chat_id": chat_id,
                "user_id": user_id
            }
        )["result"]

    def get_updates(
        self,
        offset=None
    ):

        params = {
            "limit": BATCH_LIMIT,
            "timeout": 0,

            # Telegram expects JSON-serialized list here.
            "allowed_updates": json.dumps(
                ALLOWED_UPDATES,
                ensure_ascii=False
            )
        }

        if offset is not None:
            params["offset"] = offset

        return self.request(
            "getUpdates",
            params
        )["result"]

    def send_message(
        self,
        chat_id,
        text
    ):

        return self.request(
            "sendMessage",
            {
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "HTML"
            }
        )["result"]


# ============================================================
# DATABASE
# ============================================================

EXPECTED_KEYS = {
    "id",
    "Link",
    "course",
    "Student_Score",
    "Professor_Score",
    "professor",
    "text",
}


def load_database():

    subsection(
        "DATABASE LOAD"
    )

    if not os.path.exists(DATA_FILE):

        log(
            f"⚠️ {DATA_FILE} does not exist."
        )

        log(
            "Creating a new empty database."
        )

        return []

    try:

        with open(
            DATA_FILE,
            "r",
            encoding="utf-8"
        ) as file:

            database = json.load(file)

    except Exception as exc:

        raise RuntimeError(
            f"Cannot load {DATA_FILE}: {exc}"
        )

    if not isinstance(
        database,
        list
    ):

        raise RuntimeError(
            f"{DATA_FILE} is not a JSON list."
        )

    log(
        f"✅ Loaded {len(database)} database records."
    )

    malformed_records = 0
    missing_link = 0
    invalid_id = 0

    max_id = 0

    for index, item in enumerate(
        database
    ):

        if not isinstance(
            item,
            dict
        ):

            malformed_records += 1

            log(
                f"⚠️ Record #{index} is not an object."
            )

            continue

        if "Link" not in item:

            missing_link += 1

        item_id = item.get(
            "id"
        )

        if isinstance(
            item_id,
            bool
        ):

            invalid_id += 1

        elif isinstance(
            item_id,
            int
        ):

            max_id = max(
                max_id,
                item_id
            )

        elif isinstance(
            item_id,
            str
        ):

            try:

                numeric_id = int(
                    item_id
                )

                max_id = max(
                    max_id,
                    numeric_id
                )

            except Exception:

                invalid_id += 1

        else:

            invalid_id += 1

    log(
        f"🔢 Current maximum database id = "
        f"{max_id}"
    )

    if malformed_records:
        log(
            f"⚠️ malformed records = "
            f"{malformed_records}"
        )

    if missing_link:
        log(
            f"⚠️ records without Link = "
            f"{missing_link}"
        )

    if invalid_id:
        log(
            f"⚠️ records with invalid id = "
            f"{invalid_id}"
        )

    return database


def database_state(database):

    existing_links = set()
    duplicate_existing_links = set()

    for item in database:

        if not isinstance(
            item,
            dict
        ):
            continue

        link = item.get(
            "Link"
        )

        if not link:
            continue

        if link in existing_links:

            duplicate_existing_links.add(
                link
            )

        else:

            existing_links.add(
                link
            )

    numeric_ids = []

    for item in database:

        if not isinstance(
            item,
            dict
        ):
            continue

        value = item.get(
            "id"
        )

        try:
            numeric_ids.append(
                int(value)
            )
        except Exception:
            pass

    max_id = (
        max(numeric_ids)
        if numeric_ids
        else 0
    )

    return (
        existing_links,
        duplicate_existing_links,
        max_id
    )


def atomic_write_json(
    path,
    data
):

    directory = os.path.dirname(
        path
    )

    if not directory:
        directory = "."

    os.makedirs(
        directory,
        exist_ok=True
    )

    file_descriptor = None
    temporary_path = None

    try:

        file_descriptor, temporary_path = tempfile.mkstemp(
            prefix=".scraper-",
            suffix=".tmp",
            dir=directory
        )

        with os.fdopen(
            file_descriptor,
            "w",
            encoding="utf-8"
        ) as file:

            file_descriptor = None

            json.dump(
                data,
                file,
                ensure_ascii=False,
                indent=4
            )

            file.write("\n")

            file.flush()
            os.fsync(
                file.fileno()
            )

        # Validate the generated JSON before replacing the real file.
        with open(
            temporary_path,
            "r",
            encoding="utf-8"
        ) as file:

            json.load(file)

        os.replace(
            temporary_path,
            path
        )

        temporary_path = None

    finally:

        if file_descriptor is not None:

            try:
                os.close(
                    file_descriptor
                )
            except Exception:
                pass

        if temporary_path and os.path.exists(
            temporary_path
        ):

            try:
                os.remove(
                    temporary_path
                )
            except Exception:
                pass


def write_database(
    database
):

    subsection(
        "DATABASE WRITE"
    )

    log(
        f"Writing {len(database)} records "
        f"to {DATA_FILE}"
    )

    atomic_write_json(
        DATA_FILE,
        database
    )

    # Read back once to catch accidental corruption.
    with open(
        DATA_FILE,
        "r",
        encoding="utf-8"
    ) as file:

        verified = json.load(
            file
        )

    if not isinstance(
        verified,
        list
    ):

        raise RuntimeError(
            "Post-write verification failed: "
            "data.json is not a list."
        )

    if len(verified) != len(database):

        raise RuntimeError(
            "Post-write verification failed: "
            f"expected {len(database)}, "
            f"got {len(verified)}"
        )

    log(
        f"✅ Database verified. "
        f"Records = {len(verified)}"
    )


def write_last_update():

    update_info = {
        "last_update": iran_time_string()
    }

    atomic_write_json(
        "src/last_update.json",
        update_info
    )

    log(
        "✅ src/last_update.json updated."
    )


# ============================================================
# CHANNEL VALIDATION
# ============================================================

def inspect_bot_and_channel(
    telegram
):

    section(
        "TELEGRAM ENVIRONMENT CHECK"
    )

    bot = telegram.get_me()

    bot_id = bot.get(
        "id"
    )

    log(
        f"🤖 Bot ID        : {bot_id}"
    )

    log(
        f"🤖 Bot username  : @{bot.get('username')}"
    )

    log(
        f"🤖 Bot name      : {bot.get('first_name')}"
    )

    webhook = telegram.get_webhook_info()

    webhook_url = webhook.get(
        "url"
    )

    log(
        f"🌐 Webhook set   : {bool(webhook_url)}"
    )

    log(
        f"📦 Pending count : "
        f"{webhook.get('pending_update_count')}"
    )

    log(
        f"⚠️ Webhook error : "
        f"{webhook.get('last_error_message')}"
    )

    if webhook_url:

        raise RuntimeError(
            "An outgoing webhook is configured. "
            "getUpdates cannot be used while a webhook is active."
        )

    channel = telegram.get_chat(
        CHANNEL_ID
    )

    expected_channel_id = channel.get(
        "id"
    )

    log(
        f"📢 Channel ID    : "
        f"{expected_channel_id}"
    )

    log(
        f"📢 Channel type  : "
        f"{channel.get('type')}"
    )

    log(
        f"📢 Channel name  : "
        f"{channel.get('title')}"
    )

    log(
        f"📢 Username      : "
        f"@{channel.get('username')}"
    )

    if channel.get("type") != "channel":

        raise RuntimeError(
            f"{CHANNEL_ID} is not a Telegram channel."
        )

    try:

        member = telegram.get_chat_member(
            CHANNEL_ID,
            bot_id
        )

        log(
            f"🤖 Bot membership status = "
            f"{member.get('status')}"
        )

        if member.get("user"):
            log(
                f"🤖 Member username = "
                f"@{member['user'].get('username')}"
            )

    except Exception as exc:

        log(
            f"⚠️ Could not verify bot membership: "
            f"{exc}"
        )

    return (
        expected_channel_id,
        bot_id
    )


# ============================================================
# TELEGRAM MESSAGE HELPERS
# ============================================================

def get_message_text(
    message
):

    text = message.get(
        "text"
    )

    if text:
        return text

    # Safe fallback for future caption-based posts.
    caption = message.get(
        "caption"
    )

    if caption:
        return caption

    return ""


def is_target_channel_post(
    message,
    expected_channel_id
):

    if not isinstance(
        message,
        dict
    ):
        return False

    chat = message.get(
        "chat"
    )

    if not isinstance(
        chat,
        dict
    ):
        return False

    if chat.get("type") != "channel":

        return False

    if (
        expected_channel_id is not None
        and chat.get("id") != expected_channel_id
    ):

        return False

    username = chat.get(
        "username"
    )

    if (
        username
        and username.lower()
        != CLEAN_CH_ID.lower()
    ):

        return False

    return True


# ============================================================
# BATCH PROCESSING
# ============================================================

def process_batch(
    updates,
    database,
    existing_links,
    current_max_id,
    expected_channel_id,
    run_stats
):

    subsection(
        f"PROCESSING BATCH — {len(updates)} updates"
    )

    batch_new_entries = []
    batch_errors = []

    first_update_id = (
        updates[0].get("update_id")
        if updates
        else None
    )

    last_update_id = (
        updates[-1].get("update_id")
        if updates
        else None
    )

    log(
        f"📌 update_id range: "
        f"{first_update_id} → {last_update_id}"
    )

    for position, update in enumerate(
        updates,
        start=1
    ):

        update_id = update.get(
            "update_id"
        )

        update_types = [
            key
            for key in update.keys()
            if key != "update_id"
        ]

        run_stats["updates_seen"] += 1

        for update_type in update_types:

            run_stats["update_types"][
                update_type
            ] = (
                run_stats["update_types"].get(
                    update_type,
                    0
                ) + 1
            )

        if PRINT_EVERY_UPDATE:

            log(
                f"[{position}/{len(updates)}] "
                f"update_id={update_id} "
                f"types={update_types}"
            )

        # ----------------------------------------------------
        # Only channel_post enters scraper logic.
        # ----------------------------------------------------

        if "channel_post" not in update:

            if "message" in update:

                run_stats[
                    "group_or_normal_messages"
                ] += 1

                if PRINT_EVERY_UPDATE:

                    message = update.get(
                        "message"
                    ) or {}

                    chat = message.get(
                        "chat"
                    ) or {}

                    log(
                        "   ↳ ignored non-channel "
                        f"message: "
                        f"chat_type={chat.get('type')} "
                        f"chat_username={chat.get('username')}"
                    )

            elif "edited_channel_post" in update:

                run_stats[
                    "edited_channel_posts"
                ] += 1

                log(
                    "   ↳ edited_channel_post ignored"
                )

            else:

                run_stats[
                    "other_updates"
                ] += 1

                log(
                    "   ↳ non-channel update ignored"
                )

            continue

        run_stats[
            "channel_posts_seen"
        ] += 1

        message = update.get(
            "channel_post"
        )

        if not isinstance(
            message,
            dict
        ):

            log(
                "   ❌ channel_post exists "
                "but is not a dict."
            )

            batch_errors.append(
                f"update {update_id}: malformed channel_post"
            )

            continue

        msg_id = message.get(
            "message_id"
        )

        chat = message.get(
            "chat"
        ) or {}

        chat_id = chat.get(
            "id"
        )

        chat_username = chat.get(
            "username"
        )

        log(
            f"   📢 channel_post "
            f"message_id={msg_id} "
            f"chat_id={chat_id} "
            f"username=@{chat_username}"
        )

        if not is_target_channel_post(
            message,
            expected_channel_id
        ):

            run_stats[
                "wrong_channel_posts"
            ] += 1

            log(
                "   ⚠️ channel_post is NOT "
                "the target channel. Ignored."
            )

            continue

        msg_text = get_message_text(
            message
        )

        run_stats[
            "target_channel_posts"
        ] += 1

        current_link = (
            f"https://t.me/"
            f"{CLEAN_CH_ID}/"
            f"{msg_id}"
        )

        log(
            f"   🔗 Link: {current_link}"
        )

        if current_link in existing_links:

            run_stats[
                "duplicates"
            ] += 1

            log(
                "   ♻️ DUPLICATE → skipped"
            )

            continue

        log(
            "   🆕 Link is not in database."
        )

        # Keep the same candidate detection as the old scraper.
        has_experience_indicator = any(
            indicator in msg_text
            for indicator in [
                "📚نام درس",
                "🟡درس"
            ]
        )

        if not has_experience_indicator:

            run_stats[
                "non_experience_channel_posts"
            ] += 1

            log(
                "   ↳ channel post does not "
                "contain an experience indicator."
            )

            continue

        run_stats[
            "experience_candidates"
        ] += 1

        log(
            "   ✅ Experience indicator found."
        )

        log(
            f"   📝 Text length = "
            f"{len(msg_text)}"
        )

        log(
            "   📝 Text preview:"
        )

        log(
            safe_preview(msg_text)
        )

        try:

            extracted = parse_experience(
                msg_text,
                msg_id
            )

        except Exception as exc:

            run_stats[
                "parser_errors"
            ] += 1

            error_text = (
                f"update={update_id}, "
                f"message_id={msg_id}: "
                f"{type(exc).__name__}: {exc}"
            )

            batch_errors.append(
                error_text
            )

            log(
                f"   ❌ Parser exception: "
                f"{error_text}"
            )

            log(
                traceback.format_exc()
            )

            continue

        if extracted is None:

            run_stats[
                "parser_rejected"
            ] += 1

            log(
                "   ❌ Parser returned None."
            )

            continue

        # ----------------------------------------------------
        # Assign database ID only after parser acceptance.
        # ----------------------------------------------------

        current_max_id += 1

        extracted["id"] = current_max_id

        # Exact link check one more time before append.
        extracted_link = extracted.get(
            "Link"
        )

        if (
            not extracted_link
            or extracted_link != current_link
        ):

            run_stats[
                "safety_rejections"
            ] += 1

            batch_errors.append(
                f"update {update_id}: generated Link mismatch"
            )

            log(
                "   ❌ SAFETY REJECTION: "
                "generated Link mismatch."
            )

            current_max_id -= 1

            continue

        if extracted_link in existing_links:

            run_stats[
                "duplicates"
            ] += 1

            current_max_id -= 1

            log(
                "   ♻️ DUPLICATE AFTER PARSE → skipped"
            )

            continue

        # Add immediately to the set so two updates cannot
        # create the same Link inside the same run.
        existing_links.add(
            extracted_link
        )

        batch_new_entries.append(
            extracted
        )

        run_stats[
            "accepted"
        ] += 1

        log(
            "   ✅ NEW EXPERIENCE ACCEPTED"
        )

        log(
            f"   🆔 Database id = "
            f"{extracted['id']}"
        )

        log(
            f"   📚 course = "
            f"{extracted['course']}"
        )

        log(
            f"   👨‍🏫 professor = "
            f"{extracted['professor']}"
        )

        log(
            f"   🔗 Link = "
            f"{extracted['Link']}"
        )

    return (
        batch_new_entries,
        batch_errors,
        current_max_id,
        last_update_id
    )


# ============================================================
# REPORT
# ============================================================

def send_report(
    telegram,
    status_text,
    new_count,
    database_count
):

    time_str = iran_time_string()

    report_text = (
        f"🤖 <b>گزارش خودکار اسکرپر</b>\n\n"
        f"📅 زمان اجرا: \n"
        f"<code>{time_str}</code>\n\n"
        f"✅ وضعیت: {status_text}\n"
        f"📥 تعداد جدید در این پارت: "
        f"<b>{new_count}</b>\n"
        f"📊 کل تجربیات دیتابیس: "
        f"<b>{database_count}</b>\n\n"
        f"🔗 مشاهده سایت:\n"
        f" https://IAUCourseExp.github.io/iau-experiences/"
    )

    try:

        telegram.send_message(
            REPORT_CHAT_ID,
            report_text
        )

        log(
            "✅ Final report sent to REPORT_CHAT_ID."
        )

    except Exception as exc:

        log(
            f"⚠️ Could not send final report: "
            f"{exc}"
        )


# ============================================================
# SCRAPER
# ============================================================

def scrape_with_bot():

    section(
        "🚀 IAUCourseExp SCRAPER START"
    )

    log(
        f"🕐 UTC time   : "
        f"{utc_now().strftime('%Y-%m-%d %H:%M:%S')}"
    )

    log(
        f"🕐 Iran time  : "
        f"{iran_time_string()}"
    )

    log(
        f"📌 CHANNEL_ID : "
        f"{CHANNEL_ID}"
    )

    log(
        f"📌 DATA_FILE  : "
        f"{DATA_FILE}"
    )

    log(
        f"📌 Batch limit: "
        f"{BATCH_LIMIT}"
    )

    log(
        f"📌 Max batches: "
        f"{MAX_BATCHES_PER_RUN}"
    )

    if not BOT_TOKEN:

        raise RuntimeError(
            "BOT_TOKEN environment variable is missing."
        )

    telegram = TelegramAPI(
        BOT_TOKEN
    )

    # --------------------------------------------------------
    # DATABASE
    # --------------------------------------------------------

    database = load_database()

    (
        existing_links,
        existing_duplicate_links,
        current_max_id
    ) = database_state(
        database
    )

    if existing_duplicate_links:

        log(
            f"⚠️ Existing database already contains "
            f"{len(existing_duplicate_links)} duplicate Link(s)."
        )

        log(
            "Existing data is NOT rewritten or deduplicated."
        )

    log(
        f"🔗 Unique existing links = "
        f"{len(existing_links)}"
    )

    log(
        f"🆔 Starting max database id = "
        f"{current_max_id}"
    )

    # --------------------------------------------------------
    # TELEGRAM ENVIRONMENT
    # --------------------------------------------------------

    (
        expected_channel_id,
        bot_id
    ) = inspect_bot_and_channel(
        telegram
    )

    # --------------------------------------------------------
    # RUN STATS
    # --------------------------------------------------------

    stats = {
        "batches": 0,
        "updates_seen": 0,
        "channel_posts_seen": 0,
        "target_channel_posts": 0,
        "wrong_channel_posts": 0,
        "group_or_normal_messages": 0,
        "edited_channel_posts": 0,
        "other_updates": 0,
        "duplicates": 0,
        "non_experience_channel_posts": 0,
        "experience_candidates": 0,
        "parser_rejected": 0,
        "parser_errors": 0,
        "safety_rejections": 0,
        "accepted": 0,
        "update_types": {},
    }

    run_new_entries = []

    next_offset = None

    reached_batch_limit = False
    queue_empty = False

    # --------------------------------------------------------
    # PAGINATED TELEGRAM LOOP
    # --------------------------------------------------------

    section(
        "📡 STARTING PAGINATED getUpdates LOOP"
    )

    for batch_number in range(
        1,
        MAX_BATCHES_PER_RUN + 1
    ):

        stats["batches"] += 1

        subsection(
            f"BATCH {batch_number}/{MAX_BATCHES_PER_RUN}"
        )

        if next_offset is None:

            log(
                "📥 Requesting earliest unconfirmed updates."
            )

        else:

            log(
                f"📥 Requesting updates from "
                f"offset={next_offset}"
            )

        try:

            updates = telegram.get_updates(
                next_offset
            )

        except Exception as exc:

            log(
                f"❌ getUpdates failed: {exc}"
            )

            log(
                traceback.format_exc()
            )

            raise

        log(
            f"📦 Received {len(updates)} update(s)."
        )

        # ----------------------------------------------------
        # EMPTY QUEUE
        # ----------------------------------------------------

        if not updates:

            queue_empty = True

            log(
                "✅ Telegram update queue is empty."
            )

            break

        # ----------------------------------------------------
        # PROCESS BATCH
        # ----------------------------------------------------

        (
            batch_new_entries,
            batch_errors,
            current_max_id,
            last_update_id
        ) = process_batch(
            updates=updates,
            database=database,
            existing_links=existing_links,
            current_max_id=current_max_id,
            expected_channel_id=expected_channel_id,
            run_stats=stats
        )

        # ----------------------------------------------------
        # DO NOT ACK A BATCH WITH PROCESSING ERRORS
        # ----------------------------------------------------

        if batch_errors:

            log()
            log(
                "❌ BATCH HAS PROCESSING ERRORS."
            )

            for error in batch_errors:

                log(
                    f"   ❌ {error}"
                )

            log()
            log(
                "🛑 Batch will NOT be advanced."
            )

            log(
                "The same batch will remain "
                "available for the next run."
            )

            raise RuntimeError(
                "Batch processing failed; "
                "updates intentionally not acknowledged."
            )

        # ----------------------------------------------------
        # WRITE NEW DATABASE RECORDS
        # BEFORE ACKNOWLEDGING TELEGRAM UPDATES
        # ----------------------------------------------------

        if batch_new_entries:

            log()
            log(
                f"💾 Batch produced "
                f"{len(batch_new_entries)} new record(s)."
            )

            database.extend(
                batch_new_entries
            )

            try:

                write_database(
                    database
                )

            except Exception as exc:

                log(
                    "❌ Database write failed."
                )

                log(
                    traceback.format_exc()
                )

                # Remove this batch from memory so if we
                # continue for some reason the state is clean.
                del database[
                    -len(batch_new_entries):
                ]

                for entry in batch_new_entries:

                    link = entry.get(
                        "Link"
                    )

                    if link:
                        existing_links.discard(
                            link
                        )

                current_max_id -= len(
                    batch_new_entries
                )

                raise

            run_new_entries.extend(
                batch_new_entries
            )

            write_last_update()

        else:

            log(
                "ℹ️ No new database records "
                "from this batch."
            )

        # ----------------------------------------------------
        # ACK STRATEGY
        #
        # The NEXT getUpdates request with this offset confirms
        # the current batch and returns the next batch.
        # ----------------------------------------------------

        next_offset = (
            last_update_id + 1
        )

        log(
            f"✅ Batch successfully processed."
        )

        log(
            f"➡️ Next offset = "
            f"{next_offset}"
        )

        log(
            "ℹ️ Current batch will be confirmed "
            "by the next getUpdates call."
        )

        if (
            batch_number
            < MAX_BATCHES_PER_RUN
        ):

            time.sleep(
                BETWEEN_BATCHES_SECONDS
            )

    else:

        reached_batch_limit = True

    # --------------------------------------------------------
    # BATCH LIMIT
    # --------------------------------------------------------

    if reached_batch_limit:

        subsection(
            "⚠️ MAX BATCH LIMIT REACHED"
        )

        log(
            f"Processed {MAX_BATCHES_PER_RUN} batches."
        )

        log(
            "A future manual/automatic run can continue "
            "from the next offset."
        )

    # --------------------------------------------------------
    # FINAL STATUS
    # --------------------------------------------------------

    section(
        "📊 FINAL SCRAPER SUMMARY"
    )

    log(
        f"📦 Batches processed       : "
        f"{stats['batches']}"
    )

    log(
        f"📥 Updates seen            : "
        f"{stats['updates_seen']}"
    )

    log(
        f"📢 Channel posts seen      : "
        f"{stats['channel_posts_seen']}"
    )

    log(
        f"✅ Target channel posts    : "
        f"{stats['target_channel_posts']}"
    )

    log(
        f"💬 Group/normal messages   : "
        f"{stats['group_or_normal_messages']}"
    )

    log(
        f"✏️ Edited channel posts    : "
        f"{stats['edited_channel_posts']}"
    )

    log(
        f"⚠️ Other updates           : "
        f"{stats['other_updates']}"
    )

    log(
        f"♻️ Duplicates skipped      : "
        f"{stats['duplicates']}"
    )

    log(
        f"📝 Experience candidates   : "
        f"{stats['experience_candidates']}"
    )

    log(
        f"❌ Parser rejected         : "
        f"{stats['parser_rejected']}"
    )

    log(
        f"💥 Parser errors           : "
        f"{stats['parser_errors']}"
    )

    log(
        f"✅ New entries             : "
        f"{len(run_new_entries)}"
    )

    log(
        f"📊 Final database size     : "
        f"{len(database)}"
    )

    log(
        f"🧵 Queue empty             : "
        f"{queue_empty}"
    )

    log(
        f"⛔ Batch limit reached     : "
        f"{reached_batch_limit}"
    )

    log(
        "\nUpdate types:"
    )

    for key, count in sorted(
        stats["update_types"].items()
    ):

        log(
            f"  {key}: {count}"
        )

    # --------------------------------------------------------
    # FINAL PENDING CHECK
    # --------------------------------------------------------

    subsection(
        "FINAL TELEGRAM QUEUE CHECK"
    )

    try:

        webhook = telegram.get_webhook_info()

        log(
            f"Telegram pending_update_count = "
            f"{webhook.get('pending_update_count')}"
        )

        log(
            f"Webhook configured = "
            f"{bool(webhook.get('url'))}"
        )

    except Exception as exc:

        log(
            f"⚠️ Could not read final queue status: "
            f"{exc}"
        )

    # --------------------------------------------------------
    # REPORT
    # --------------------------------------------------------

    if reached_batch_limit:

        if run_new_entries:

            status_text = (
                "تجربه جدید اضافه شد 📥 "
                "صف هنوز کامل تخلیه نشده و اجرای بعدی ادامه می‌دهد."
            )

        else:

            status_text = (
                "⚠️ این اجرا به سقف پارت‌ها رسید؛ "
                "اجرای بعدی صف را ادامه می‌دهد."
            )

    elif run_new_entries:

        status_text = (
            "تجربه جدید اضافه شد 📥"
        )

    else:

        status_text = (
            " تجربه جدیدی نبود 😴 "
            "تجاربتون رو بفرستید به بات تجربیات | "
            "@IAUCourseExpBot "
        )

    send_report(
        telegram=telegram,
        status_text=status_text,
        new_count=len(run_new_entries),
        database_count=len(database)
    )

    section(
        "🏁 SCRAPER FINISHED SUCCESSFULLY"
    )

    log(
        f"📥 New experiences this run: "
        f"{len(run_new_entries)}"
    )

    log(
        f"📊 Database total: "
        f"{len(database)}"
    )


# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":

    try:

        scrape_with_bot()

    except Exception as exc:

        section(
            "💥 FATAL SCRAPER ERROR"
        )

        log(
            f"Exception type: "
            f"{type(exc).__name__}"
        )

        log(
            f"Exception: "
            f"{exc}"
        )

        log(
            "\nFULL TRACEBACK:"
        )

        log(
            traceback.format_exc()
        )

        # Try to send an error report without masking
        # the original failure.
        try:

            if (
                BOT_TOKEN
                and REPORT_CHAT_ID
            ):

                telegram = TelegramAPI(
                    BOT_TOKEN
                )

                error_report = (
                    f"🤖 <b>گزارش خودکار اسکرپر</b>\n\n"
                    f"📅 زمان اجرا: \n"
                    f"<code>{iran_time_string()}</code>\n\n"
                    f"✅ وضعیت: ❌ خطا در اجرای اسکرپر\n"
                    f"📥 تعداد جدید در این پارت: <b>نامشخص</b>\n"
                    f"📊 کل تجربیات دیتابیس: <b>خطا</b>\n\n"
                    f"🔗 مشاهده سایت:\n"
                    f" https://IAUCourseExp.github.io/iau-experiences/"
                )

                telegram.send_message(
                    REPORT_CHAT_ID,
                    error_report
                )

        except Exception:

            pass

        sys.exit(1)
