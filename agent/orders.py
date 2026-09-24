#!/usr/bin/env python3
"""أداة الإيجنت للتعامل مع خادم الطلبات (backend/worker.js).

المتغيرات في البيئة:
  AHSEBHA_API          عنوان الخادم، مثل https://ahsebha-orders.NAME.workers.dev
  AHSEBHA_AGENT_TOKEN  (اختياري) نفس قيمة AGENT_TOKEN. إذا مش موجود، منفترض إن
                       بيئة Claude بتضيف ترويسة Authorization لحالها (API credentials).

الاستعمال:
  python3 agent/orders.py list [--status paid,in_progress]
  python3 agent/orders.py show ORDER_ID
  python3 agent/orders.py claim ORDER_ID
  python3 agent/orders.py deliver ORDER_ID --text result.txt [--file out.docx ...] [--note "..."]
  python3 agent/orders.py flag ORDER_ID --reason "سبب داخلي" [--note "رسالة للزبون"]
  python3 agent/orders.py set ORDER_ID STATUS [--note "..."]      # paid | refunded | cancelled
"""
import argparse
import base64
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.request

MIME = {
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".pdf": "application/pdf",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".md": "text/markdown",
}


def config():
    api = os.environ.get("AHSEBHA_API", "").rstrip("/")
    token = os.environ.get("AHSEBHA_AGENT_TOKEN", "")
    if not api:
        sys.exit("AHSEBHA_API مش موجود بالبيئة. ضيفه بإعدادات البيئة.")
    return api, token


def call(method, path, body=None):
    api, token = config()
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json", "User-Agent": "ahsebha-agent/1.0"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(api + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')}")
    except urllib.error.URLError as e:
        sys.exit(f"ما قدرت أوصل للخادم ({e.reason}). تأكد إن الشبكة بتسمح بـ {api}.")


def main():
    p = argparse.ArgumentParser(description="طلبات خدمات احسبها")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("list"); s.add_argument("--status", default="paid,in_progress")
    s = sub.add_parser("show"); s.add_argument("id")
    s = sub.add_parser("claim"); s.add_argument("id")
    s = sub.add_parser("deliver"); s.add_argument("id")
    s.add_argument("--text", required=True, help="ملف نص الرد للزبون")
    s.add_argument("--file", action="append", default=[], help="ملف مرفق (يتكرر)")
    s.add_argument("--note", help="ملاحظة قصيرة تظهر للزبون")
    s = sub.add_parser("flag"); s.add_argument("id"); s.add_argument("--reason", required=True); s.add_argument("--note")
    s = sub.add_parser("set"); s.add_argument("id"); s.add_argument("status"); s.add_argument("--note")
    a = p.parse_args()

    if a.cmd == "list":
        out = call("GET", "/api/agent/orders?status=" + a.status)
        print(json.dumps(out, ensure_ascii=False, indent=2))
    elif a.cmd == "show":
        print(json.dumps(call("GET", f"/api/agent/orders/{a.id}"), ensure_ascii=False, indent=2))
    elif a.cmd == "claim":
        print(json.dumps(call("POST", f"/api/agent/orders/{a.id}/status", {"status": "in_progress"}), ensure_ascii=False))
    elif a.cmd == "deliver":
        with open(a.text, encoding="utf-8") as fh:
            text = fh.read()
        files = []
        for path in a.file:
            ext = os.path.splitext(path)[1].lower()
            with open(path, "rb") as fh:
                files.append({
                    "name": os.path.basename(path),
                    "mime": MIME.get(ext) or mimetypes.guess_type(path)[0] or "application/octet-stream",
                    "base64": base64.b64encode(fh.read()).decode("ascii"),
                })
        body = {"text": text, "files": files}
        if a.note:
            body["publicNote"] = a.note
        print(json.dumps(call("POST", f"/api/agent/orders/{a.id}/deliver", body), ensure_ascii=False))
    elif a.cmd == "flag":
        body = {"status": "needs_review", "note": a.reason, "publicNote": a.note or "نراجع طلبك وسنتواصل معك عبر بريدك الإلكتروني."}
        print(json.dumps(call("POST", f"/api/agent/orders/{a.id}/status", body), ensure_ascii=False))
    elif a.cmd == "set":
        body = {"status": a.status}
        if a.note:
            body["publicNote"] = a.note
        print(json.dumps(call("POST", f"/api/agent/orders/{a.id}/status", body), ensure_ascii=False))


if __name__ == "__main__":
    main()
