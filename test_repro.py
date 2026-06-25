import requests
import time

def main():
    print("Sending chat 1")
    requests.post("http://127.0.0.1:8766/api/chat", json={"text": "hôm nay trời đẹp ha"})
    requests.post("http://127.0.0.1:8766/api/flush", json={})
    print("Wait...")
    time.sleep(2)
    print("Sending chat 2")
    requests.post("http://127.0.0.1:8766/api/chat", json={"text": "ê đi chơi không"})
    requests.post("http://127.0.0.1:8766/api/flush", json={})
    print("Wait...")
    time.sleep(2)
    print("Sending chat 3 (multi)")
    requests.post("http://127.0.0.1:8766/api/chat", json={"text": "có quán cà phê ngon lắm"})
    requests.post("http://127.0.0.1:8766/api/chat", json={"text": "đi thôi"})
    res = requests.post("http://127.0.0.1:8766/api/flush", json={})
    print(res.status_code, res.text)

if __name__ == "__main__":
    main()
