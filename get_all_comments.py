import requests
import os
import json

def get_all(url):
    all_data = []
    page = 1
    while True:
        r = requests.get(url + f"?page={page}&per_page=100")
        data = r.json()
        if not data:
            break
        if isinstance(data, dict) and "message" in data:
            print(f"Error: {data['message']}")
            break
        all_data.extend(data)
        if len(data) < 100:
            break
        page += 1
    return all_data

owner = "rafaeltcosta86"
repo = "elvis"
number = "105"

issue_comments = get_all(f"https://api.github.com/repos/{owner}/{repo}/issues/{number}/comments")
review_comments = get_all(f"https://api.github.com/repos/{owner}/{repo}/pulls/{number}/comments")

all_comments = []
for c in issue_comments:
    all_comments.append({"user": c["user"]["login"], "body": c["body"], "created": c["created_at"], "type": "issue"})
for c in review_comments:
    all_comments.append({"user": c["user"]["login"], "body": c["body"], "created": c["created_at"], "type": "review", "path": c.get("path"), "line": c.get("line")})

all_comments.sort(key=lambda x: x["created"])

for c in all_comments:
    print(f"--- {c['user']} ({c['type']}) at {c['created']} ---")
    if 'path' in c and c['path']:
        print(f"File: {c['path']} Line: {c['line']}")
    print(c['body'])
