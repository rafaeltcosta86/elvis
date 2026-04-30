import requests
import json
import os

def get_github_comments(repo, issue_number):
    url = f"https://api.github.com/repos/{repo}/issues/{issue_number}/comments"
    res = requests.get(url)
    if res.status_code != 200:
        print(f"Error fetching issue comments: {res.status_code}")
        return []
    return res.json()

def get_pull_comments(repo, pull_number):
    url = f"https://api.github.com/repos/{repo}/pulls/{pull_number}/comments"
    res = requests.get(url)
    if res.status_code != 200:
        print(f"Error fetching pull comments: {res.status_code}")
        return []
    return res.json()

repo = "rafaeltcosta86/elvis"
pr_number = 105

print("--- ISSUE COMMENTS ---")
for c in get_github_comments(repo, pr_number):
    print(f"[{c['created_at']}] {c['user']['login']}: {c['body']}\n")

print("--- PULL REQUEST DIFF COMMENTS ---")
for c in get_pull_comments(repo, pr_number):
    print(f"[{c['created_at']}] {c['user']['login']}: {c['body']}\n")
