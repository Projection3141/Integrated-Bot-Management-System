<!-- =========================================================
FILE: README.md
========================================================= -->

# Puppeteer Chromium Utility (PowerShell-friendly) — Max 4 Cache (LRU)

## 목표
- `profiles.json`으로 국가/언어/타임존/헤더/크롬 args를 분리해서 관리
- 프로파일 키별 **브라우저 1개 재사용**
- 전체 브라우저 캐시는 **최대 4개**로 제한하고 **LRU 방식으로 자동 퇴출(evict)**
- 30초 단위로 **예상 메모리 점유 리포트** (Node + 가능하면 Chromium WorkingSet)

---

## 설치 / 실행 (PowerShell)

```powershell
mkdir puppeteer-util
cd puppeteer-util

npm init -y
npm i puppeteer

# 아래 파일 3개 생성 후 실행
node .\test.js