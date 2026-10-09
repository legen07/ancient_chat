#!/usr/bin/env python3
"""Test client to verify the webhook works when deployed."""

import json
import requests
import sys

# CONFIGURE YOUR URLs HERE
WORKER_URL = "http://ancient-chat.YOUR-WORKER-ID.workers.dev"
WEBHOOK_URL = f"{WORKER_URL}/api/webhook/"
LISTEN_URL = f"{WORKER_URL}/api/listen?domain={WORKER_URL.rsplit('/', 2)[-1]}"

def test_setup_webhook():
    """Test the webhook setup endpoint"""
    print(f"\n=== Testing Webhook Setup ===")
    print(f"POST {LISTEN_URL}")
    try:
        resp = requests.post(LISTEN_URL, timeout=10)
        print(f"Response: {resp.status_code} - {resp.text}")
        if resp.status_code == 200:
            print("✅ Webhook set up successfully!")
        else:
            print(f"❌ Webhook setup failed: {resp.text}")
        return resp.status_code == 200
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

def test_webhook(message):
    """Test sending a message through the webhook"""
    print(f"\n=== Testing Webhook Message ===")
    print(f"Message: {message}")
    
    payload = {
        "message": {
            "from": {
                "id": 123456789,
                "chat_type": "private",
                "first_name": "Test User",
                "username": "testuser",
                "language_code": "en"
            },
            "date": 1234567890,
            "text": message
        }
    }
    
    try:
        resp = requests.post(WEBHOOK_URL, json=payload, timeout=60)
        print(f"Response: {resp.status_code}")
        if resp.status_code == 200:
            print("✅ Webhook received message successfully!")
        else:
            print(f"❌ Webhook response: {resp.text}")
        return resp.status_code == 200
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

def test_root():
    """Test the root endpoint"""
    print(f"\n=== Testing Root Endpoint ===")
    try:
        resp = requests.get(WORKER_URL, timeout=10)
        print(f"Response: {resp.status_code} - {resp.text[:100]}")
        return resp.status_code == 200
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

if __name__ == "__main__":
    print("=" * 60)
    print("Ancient Chat Bot - Test Script")
    print("=" * 60)
    print(f"\nWorker URL: {WORKER_URL}")
    print(f"Webhook URL: {WEBHOOK_URL}")
    print(f"Listen URL: {LISTEN_URL}")
    print("\nTo run tests, edit WORKER_URL in this script\n")
    print("1. Test root endpoint: python3 test_bot.py --root")
    print("2. Set up webhook: python3 test_bot.py --setup")
    print("3. Send test message: python3 test_bot.py --message 'Hello!'"
    print("\nOR manually:")
    print(f"  Setup webhook: curl -X POST {LISTEN_URL}")
    print(f"  Send message: curl -X POST {WEBHOOK_URL} -H 'Content-Type: application/json' -d '{json.dumps({\"message\": {\"from\": {\"id\": 123, \"first_name\": \"Test\", \"language_code\": \"en\"}, \"text\": \"Hello!'}})}''")