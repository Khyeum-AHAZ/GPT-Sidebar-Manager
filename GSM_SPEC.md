# GSM — GPT Sidebar Manager
## Codex 구현 명세서 v1.0

### 0. 프로젝트 개요
- 프로젝트명: **GSM**
- 표시명: **GPT Sidebar Manager**
- 목적: ChatGPT 웹의 공식 프로젝트 기능은 그대로 유지하면서, 사이드바의 프로젝트/최근 채팅 정리 기능을 보완하는 개인용 Chrome 확장 프로그램.
- 배포: Chrome Web Store 미사용. 공개 GitHub 저장소의 Releases에서 ZIP을 받아 로컬 폴더로 압축 해제하여 집과 회사 PC에서 설치.
- 사용 환경:
  - Chrome
  - 같은 Google 계정으로 Chrome Sync 사용
  - ChatGPT Web
- 원칙:
  - ChatGPT 원본 데이터 비파괴
  - 외부 서버 없음
  - 텔레메트리/광고 없음
  - 대화 본문 저장 금지
  - ChatGPT UI 변경 시 Fail-Open
  - ChatGPT DOM 접근은 Adapter 계층 외부에서 금지

---

# 1. 핵심 목표

## 1.1 최근 채팅 정리
ChatGPT 공식 프로젝트에 속한 채팅은 일반 **Recents/최근 채팅 목록에서 숨긴다.**

- 프로젝트 소속이 확실히 확인된 채팅만 숨긴다.
- 프로젝트 소속 여부가 불확실하면 숨기지 않는다.
- 채팅 DOM 자체를 삭제하지 않는다.
- 가급적 확장 CSS/상태로 시각적으로만 숨긴다.
- 팝업의 GSM 표시 OFF 또는 UI 인식 오류 시 즉시 원본 UI가 복구되어야 한다. Chrome 확장 카드 OFF는 탭 새로고침 후 복구한다.

## 1.2 프로젝트 내부 가상 폴더
ChatGPT 공식 프로젝트 아래에 GSM 전용 **1단계 가상 폴더**를 제공한다.

예:

```text
Projects

▼ Structure
   ▼ 세계관
      내일
      세레드 설정
   ▶ 플롯
   ▶ 자료 조사
   새 채팅

▶ Portrait Lab

Recents
   차량 정비
   제빵기 추천
   기타 일반 채팅
```

### 폴더 규칙
- 1단계 폴더만 지원한다.
- 하위 폴더의 하위 폴더는 지원하지 않는다.
- 사용자 폴더 생성 가능.
- 폴더 이름 변경 가능.
- 폴더 삭제 가능.
- 폴더 삭제 시 해당 폴더의 채팅은 삭제하지 않고 프로젝트 바로 아래에 표시한다.
- 폴더가 지정되지 않은 프로젝트 채팅은 별도 시스템 폴더 없이 프로젝트 바로 아래에 표시한다.

---

# 2. UI 원칙

## 2.1 Chrome 확장 아이콘 팝업
확장 아이콘 팝업은 **설정/상태/복구 기능**을 담당한다.

예상 UI:

```text
GPT Sidebar Manager                 ON

기본 기능
☑ 프로젝트 채팅을 최근 목록에서 숨김
☑ 프로젝트 폴더 기능
☑ 안전 드래그앤드롭

실험 기능
☐ 전체 드래그 허용
☐ 네트워크 자동 인식

동기화
Chrome Sync                         정상

인식 상태
DOM 인식                            정상
Network 인식                        꺼짐

프로젝트 학습
[미학습 프로젝트 일괄학습]
[모든 프로젝트 다시 학습]
[현재 프로젝트 다시 읽기]

고급
[학습 캐시 초기화]
```

## 2.2 ChatGPT 사이드바
실제 채팅 정리 조작은 ChatGPT 왼쪽 사이드바에서 수행한다.

- ChatGPT의 프로젝트 영역 근처에 GSM 독립 DOM Root를 삽입.
- 프로젝트/폴더/채팅 트리는 GSM이 관리하는 독립 DOM으로 렌더링.
- ChatGPT 원본 DOM 구조를 가능한 한 직접 뜯어고치지 않는다.
- ChatGPT 기본 디자인과 최대한 유사한 스타일을 사용.
- 채팅 글꼴·크기·색상은 원본 채팅 행의 계산된 스타일을 Adapter에서 읽어 GSM 루트에 전달하고 하위 요소가 상속한다. 상위 사이드바 컨테이너는 실제 채팅 행과 글자 크기가 다를 수 있으므로 기준으로 사용하지 않는다. 고정 12px/반투명 표현을 사용하지 않고, 프로젝트 → 하위 폴더 → 채팅은 아이콘과 들여쓰기로 구분한다.
- 사이드바에 제품명/폴더 영역 제목과 상시 동기화 문구를 표시하지 않는다. 동기화 상태 및 오류는 확장 팝업에서 확인한다.
- 새 폴더는 원본 프로젝트 이름 옆 `폴더＋` 아이콘으로 생성한다. 추가 아이콘은 Adapter에서 가역적으로 삽입하고, 클릭으로 원본 접기/펼치기를 실행하지 않는다. 아이콘은 드롭 대상에서 제외하되 프로젝트 제목 줄의 Full Drag는 유지한다.
- 사용자 하위 폴더의 우클릭 또는 `···` 메뉴에 이름 변경, 폴더 색상, 삭제를 둔다. ChatGPT 원본 프로젝트 메뉴는 수정하지 않는다.
- 하위 폴더 아이콘은 원본 프로젝트 아이콘과 같은 형태를 사용하며 실제 프로젝트 아이콘 크기의 약 95%로 표시한다. 아이콘에만 선명한 네온 계열 20색과 기본(원본 색 상속)을 제공한다. 글자색/배경색은 변경하지 않는다. 초기 파스텔/80% 안은 실제 화면에서 희미하고 작다는 사용자 피드백으로 대체했다.
- 프로젝트/폴더 접기·펼치기 지원.
- 접기/펼치기 상태 기억.
- 프로필 메뉴에는 GSM 항목을 삽입하지 않는다.

## 2.3 채팅 `···` 메뉴
가능하다면 기존 채팅 컨텍스트 메뉴에 다음 한 항목을 추가:

```text
폴더로 분류 >
```

하위 메뉴:
- 현재 프로젝트의 사용자 폴더 목록
- 프로젝트 바로 아래
- 새 폴더

드래그가 실패하거나 불편한 경우의 백업 조작 수단으로 사용한다.

---

# 3. Drag & Drop

## 3.1 기본 안전 모드 — 기본값
기본값에서는 GSM이 소유한 로컬 정리 상태만 변경한다.

허용:
- 같은 프로젝트 내 `프로젝트 바로 아래 → 폴더`
- 같은 프로젝트 내 `폴더 A → 폴더 B`
- `폴더 → 프로젝트 바로 아래`
- 같은 폴더 안에서 채팅 순서 변경
- 폴더 순서 변경

금지:
- 프로젝트 A → 프로젝트 B
- Recents → 프로젝트
- 프로젝트 → Recents

### 원칙
기본 안전 드래그는 **ChatGPT 서버 상태를 변경하지 않는다.**

## 3.2 전체 드래그 허용 — 실험 옵션
옵션:

```text
☐ 전체 드래그 허용 [실험적]
```

ON 시 추가 허용:
- 프로젝트 A → 프로젝트 B
- Recents → 프로젝트
- 프로젝트 → Recents
- 가능하면 Recents → 프로젝트의 특정 GSM 폴더

이 기능은 기본 Drag 엔진과 분리된 모듈로 구현한다.

### 전체 드래그 처리 원칙
ChatGPT 실제 프로젝트 이동이 필요한 경우:

```text
Drop
  ↓
ChatGPT 실제 프로젝트 이동 수행
  ↓
성공 확인
  ↓
GSM 로컬 폴더/순서 데이터 반영
  ↓
UI 확정
```

실패 시:
- GSM 로컬 상태 변경 금지
- 실제 ChatGPT 이동이 확인되지 않았으면 GSM 로컬 상태를 확정하지 않음
- 실제 이동은 확인됐으나 후속 로컬 저장이 실패하면 원본 UI로 역방향 이동을 시도하고 결과를 확인
- 역방향 이동도 실패하면 실제 ChatGPT 소속을 다시 읽어 표시하고 수동 복구가 필요함을 알림
- 출발/대상 프로젝트 이름이 중복되어 원본 메뉴에서 ID로 구분할 수 없으면 이동을 중지
- GSM은 확인되지 않은 원래 위치를 성공한 롤백으로 표시하지 않음

이 기능은 실험 기능이며 실패 시 안전 드래그 기능에 영향을 주면 안 된다.

---

# 4. 프로젝트 소속 판별

## 4.1 A — DOM Membership Provider
기본 판별 방식.

프로젝트 페이지/사이드바 등 화면에 실제로 렌더링된 정보에서:
- project ID
- conversation ID
- 프로젝트 membership

을 읽는다.

제목 문자열을 식별 키로 사용하지 않는다.

우선 식별자:
1. URL / href의 안정적인 ID
2. 의미 있는 `data-*`
3. `aria-*`, `role`
4. 안정적인 구조 관계
5. 텍스트
6. CSS class / `nth-child`는 최후수단

## 4.2 B — Network Membership Provider [실험적]
옵션:

```text
☐ 네트워크 자동 인식 [실험적]
```

B는 ChatGPT가 **원래 수행하는 네트워크 요청/응답을 수동적으로 관찰**한다.

구현 기준:
- `webRequest`만으로는 응답 본문의 membership을 읽을 수 없으므로, B가 활성화된 동안에만 페이지 실행 환경의 `fetch`/XHR 응답을 관찰하는 별도 브리지를 사용한다.
- 브리지는 원래 요청·응답·예외를 변경하지 않고, 응답 복사본에서 허용된 membership 메타데이터만 추출한다. 응답 원문은 저장하거나 다른 모듈로 전달하지 않는다.
- 관찰 대상·추출 형식을 실제 ChatGPT 동작에서 확인할 수 없거나 브리지에 오류가 나면 B만 중지하고 A+C를 유지한다. `debugger` 권한은 사용하지 않는다.
- B가 OFF이면 브리지는 네트워크 관찰을 하지 않는다. 팝업의 `[B 지금 다시 확인]`은 설정을 바꾸지 않는 일회성 관찰이다. 현재 프로젝트 화면을 다시 읽고, 필요한 경우 안전하게 새로고침할 수 있을 때만 기존 페이지 요청을 다시 관찰한다. 응답이 발생하지 않으면 갱신 성공으로 표시하지 않는다. 비공개 API를 직접 호출하지 않는다.

허용:
- projectId
- conversationId
- 필요 시 projectName
- membership 메타데이터 추출

금지:
- 인증 토큰 저장
- 쿠키 저장
- ChatGPT 비공개 API 직접 호출
- 대화 본문 저장
- 전체 응답 원문 저장
- 네트워크 요청 변경/조작

B가 실패해도 A+C는 계속 정상 동작해야 한다.

## 4.3 C — Local Registry
A/B에서 확인된 membership을 로컬 캐시에 기록.

예:

```text
conversationId -> projectId
```

신뢰도 우선순위:

```text
현재 DOM에서 직접 확인한 상태
    >
현재 네트워크 응답에서 확인한 상태
    >
과거 로컬 캐시
```

ChatGPT 실제 상태와 GSM 캐시가 충돌하면 **ChatGPT 실제 상태가 항상 우선**.

캐시는 과거에 ID로 직접 확인한 membership만 보관하고, 현재 A/B의 반대 증거가 없으면 Recents 필터에 사용할 수 있다. 현재 화면에서 소속이 불확실하거나 ID가 확인되지 않은 항목은 숨기지 않는다. 다른 탭·PC에서 발생한 프로젝트 이동은 해당 프로젝트를 다시 읽기 전까지 캐시에 반영되지 않을 수 있다.

---

# 5. 초기 학습 / 재학습

## 5.1 기본 사용
프로젝트를 사용자가 열면 자동으로:
- 현재 프로젝트 ID 확인
- 현재 프로젝트 채팅 목록 확인
- Registry 증분 업데이트
- 신규/제거 membership 반영
- Recents 필터 갱신

현재 열린 화면은 첫 사이드바 방문, SPA 이동, 탭 재활성화 및 관련 DOM 변경 시 재확인한다. DOM 변경은 debounce하며, 화면이 활성 상태일 때 약 30초마다 가벼운 변경 확인을 추가한다. 이 주기 점검은 현재 렌더링된 화면에 한정되며 모든 프로젝트의 서버 상태를 갱신한다고 간주하지 않는다.

## 5.2 초기 일괄학습
팝업에:

```text
[미학습 프로젝트 일괄학습]
```

제공.

동작:
1. 사용 가능한 프로젝트 목록 파악.
2. 일괄학습 중에 B(Network Provider)를 임시 활성화할 수 있음.
3. 프로젝트를 순차적으로 로드/방문하여 A+B로 membership 수집.
4. Registry 저장.
5. 끝나면 Network 옵션이 원래 OFF였다면 다시 OFF.
6. 사용자에게 성공/실패 프로젝트를 표시.

예:

```text
Structure       ✓ 18개
Portrait Lab    ✓ 27개
Vehicle         ✓ 11개
Novel           실패
```

### 주의
백그라운드 탭 자동 순회가 ChatGPT에서 안정적으로 작동하는지 먼저 검증한다.

안 되면 폴백:
- 현재 탭 순차 방문
또는
- 사용자가 프로젝트를 한 번씩 열도록 안내

비공개 API 직접 호출로 대체하지 않는다.

## 5.3 추가 복구 기능
팝업:
- `[현재 프로젝트 다시 읽기]`
- `[미학습 프로젝트 일괄학습]`
- `[모든 프로젝트 다시 학습]`
- `[학습 캐시 초기화]`

`학습 캐시 초기화`는:
- membership cache만 초기화
- 가상 폴더/채팅 분류 정보는 절대 삭제하지 않음

---

# 6. 저장 / 동기화

## 6.1 chrome.storage.sync
같은 Google 계정의 집/회사 Chrome에서 공유해야 하는 **사용자 정리 정보** 저장:

- GSM 사용자 폴더
- 폴더 이름
- 폴더 순서
- conversationId → folderId 배치
- 채팅 수동 순서
- 폴더 접기/펼치기 상태
- 사용자 옵션
- 실험 옵션 상태

팝업의 `GSM 사용 (이 기기)` 스위치는 기기별 표시 제어이므로 동기화하지 않는다.

Sync 쓰기 실패나 일시적인 연결 문제에도 사용자 정리 정보를 유지하기 위해 `chrome.storage.local`에 사용자 정리 정보의 로컬 사본과 동기화 대기 상태도 둔다. 로컬 저장 성공과 Sync 성공을 구별해 표시하고, 재동기화 시 개별 엔티티의 버전 정보를 기준으로 병합한다.

## 6.2 chrome.storage.local
PC별로 달라도 되는 **학습/캐시 정보** 저장:

- DOM membership cache
- Network membership cache
- 마지막 스캔 시각
- Adapter 상태
- 오류 상태
- 임시 동작 상태
- 일괄학습 진행 상태(필요 시)
- 팝업의 GSM 표시 ON/OFF 상태 (기본 ON)

## 6.3 충돌 해결
폴더 색상은 기존 v2 폴더 레코드의 선택 필드 `color`로 저장한다. 필드가 없는 기존 폴더는 기본색으로 표시하며, 색상 변경도 폴더 revision/updatedAt과 기존 Sync 충돌 규칙을 따른다.

sync 데이터에는 가능하면 개별 엔티티에:
- `updatedAt`
또는
- revision

을 둔다.

전체 설정 파일 하나를 통째로 마지막 저장 승리 방식으로 덮어쓰지 않는다.

가능하면:
- 폴더 단위
- conversation-folder membership 단위
- 옵션 단위

로 충돌을 해결한다.

최신 변경 우선.

삭제된 폴더·배치가 다른 PC에서 되살아나지 않도록 삭제 기록도 충돌 해결에 포함한다. Sync의 총량·항목 수·항목당 크기·쓰기 횟수 제한을 넘으면 오류를 표시하고 로컬 사본을 유지한다. 두 PC는 같은 확장 ID로 설치해야 Sync 데이터가 공유된다.

---

# 7. 아키텍처

권장 모듈:

```text
src/
  adapter/
    ChatGPTAdapter.js

  membership/
    DomMembershipProvider.js
    NetworkMembershipProvider.js
    MembershipRegistry.js

  sidebar/
    SidebarRoot.js
    ProjectTree.js
    FolderTree.js
    RecentFilter.js

  drag/
    SafeDragController.js
    CrossProjectDragController.js

  storage/
    SyncStore.js
    LocalCache.js
    Migration.js

  learning/
    ProjectScanner.js
    BulkLearner.js

  popup/
    popup.html
    popup.js
    popup.css

  core/
    StateManager.js
    FeatureFlags.js
    ErrorBoundary.js
```

실제 파일명은 Codex가 더 적절한 구조로 조정해도 되지만 **책임 분리 원칙은 유지**한다.

## 7.1 가장 중요한 규칙
**ChatGPT DOM 접근은 `ChatGPTAdapter` 외부에서 금지.**

다른 모듈이 직접:
- querySelector
- 특정 CSS class
- nth-child
- ChatGPT DOM traversal

을 수행하지 않게 한다.

Adapter는 의미 있는 API만 제공:

```text
getSidebarRoot()
getRecentChats()
getProjects()
getCurrentProject()
getConversationId(node)
getProjectId(node)
observeSidebarChanges()
```

ChatGPT UI 변경 시 Adapter 중심으로 수정 가능해야 한다.

---

# 8. ChatGPT UI 변경 내성

## 8.1 Fail-Open
핵심 DOM 구조를 확실히 인식할 수 없으면:

- 채팅을 숨기지 않음
- 기존 ChatGPT DOM을 삭제하지 않음
- GSM UI를 철회하거나 중지
- 원본 ChatGPT UI를 그대로 표시
- 사용자 데이터 쓰기 금지

## 8.2 여러 탐색 전략
Adapter 내부에서:

```text
Strategy 1: stable attributes / href / IDs
  ↓ 실패
Strategy 2: accessibility attributes
  ↓ 실패
Strategy 3: stable structural relationship
  ↓ 실패
Fail-Open
```

CSS 빌드 클래스와 nth-child에 깊게 의존하지 않는다.

## 8.3 DOM 비파괴
- 원본 ChatGPT DOM 제거 금지.
- GSM이 만든 요소에는 명확한 ownership marker 사용.

예:
```html
data-gsm-owned="true"
```

- Recents 숨김은 reversible 방식으로 구현.
- 팝업의 GSM 표시 OFF 시 원본 UI를 즉시 복구. Chrome 확장 카드 OFF는 열린 탭을 새로고침해야 원본 상태를 보장한다.

## 8.4 MutationObserver
금지:
- `document.body` 전체를 무제한 감시
- GSM 자체 DOM 변경으로 재귀 스캔

권장:
- sidebar/project 관련 좁은 container만 감시
- debounce 100~300ms
- 상태 비교 후 실제 변경 시에만 렌더링
- `data-gsm-owned` 노드는 감시 이벤트에서 제외/무시

## 8.5 오류 대응
짧은 시간에 반복 오류가 발생하면:
- 해당 기능 또는 GSM UI를 Safe Mode로 전환
- 원본 ChatGPT UI 유지
- 무한 재시도 금지
- CPU 폭주 금지

예:

```text
⚠ ChatGPT 화면 구조를 인식할 수 없습니다.
정리 기능을 일시 중지했습니다.
원본 UI를 유지합니다.

[다시 시도]
```

---

# 9. 기능별 독립 실패

각 기능은 가능한 한 독립적으로 실패해야 한다.

예:

```text
DOM Membership        정상
Recent Filter         정상
Folder UI             오류
Safe Drag             비활성
Network Provider      오류
Sync                   정상
```

규칙:
- B 실패 → B만 비활성 / A+C 유지
- Cross Project Drag 실패 → 실험 Drag만 비활성 / Safe Drag 유지
- Folder UI 오류 → 저장/Sync 손상 금지
- Sync 오류 → Local cache로 계속 사용 가능
- 핵심 sidebar Adapter 실패 → Fail-Open

---

# 10. 데이터 무결성

## 10.1 식별
채팅 제목을 식별자로 사용하지 않는다.

기본:
- `conversationId`
- `projectId`
- GSM `folderId`

## 10.2 폴더 삭제
폴더 삭제:
- folder metadata 삭제
- 해당 folder의 모든 conversation → `folderId: null` (프로젝트 바로 아래)
- ChatGPT 원본 채팅은 변경/삭제하지 않음

## 10.3 프로젝트 이동 감지
사용자가 ChatGPT 기본 UI의 `프로젝트로 이동` / `프로젝트에서 제거`를 사용할 수 있다.

GSM은 다음 학습 시 실제 상태를 확인하여:
- 기존 project membership 제거
- 새 project membership 저장
- 기존 프로젝트의 GSM folder assignment 제거
- 새 프로젝트에서는 기본적으로 프로젝트 바로 아래에 표시

ChatGPT 실제 상태가 GSM보다 우선한다.

---

# 11. 비목표 / 구현하지 않을 기능

v1에서 명시적으로 제외:

- 무제한 하위 폴더
- 별도 계정 시스템
- 외부 서버
- 자체 클라우드
- 광고
- 텔레메트리
- 대화 본문 인덱싱
- 전체 메시지 검색
- 프롬프트 라이브러리
- Smart Tag
- PDF/Markdown/JSON 내보내기
- 채팅 내용 백업
- ChatGPT 계정 간 데이터 이전
- 자체 프로젝트 생성/삭제
- ChatGPT 원본 프로젝트 기능 대체
- 비공개 API 직접 호출
- 인증 토큰 수집/저장
- 쿠키 수집/저장

---

# 12. 권한 최소화

Manifest V3 사용.

권한은 구현에 필요한 최소 범위만 요청한다.

목표:
- ChatGPT 사이트 접근
- storage
- 필요한 경우 scripting

불필요한 광범위 권한 금지.

특히:
- cookies 권한은 필요하지 않다면 사용 금지.
- webRequest/광범위 network 권한은 B 구현에 꼭 필요한지 검증 후 최소화.
- 인증정보 접근 목적의 권한 요청 금지.

---

# 13. 옵션 기본값

초기 기본값 권장:

```text
Extension enabled                  ON
GSM display (popup, per device)    ON
Hide project chats from Recents   ON
Folder UI                         ON
Safe drag                         ON

Full drag                         OFF
Network auto detection            OFF
```

실험 옵션을 처음 ON할 때 한 번만 설명 표시.

---

# 14. GSM 표시 OFF / Chrome 확장 OFF 동작

팝업의 `GSM 사용 (이 기기)`를 OFF로 바꾸면 진행 중인 이동·학습의 안전한 종료 후:
- GSM CSS 제거
- GSM 삽입 DOM 제거
- MutationObserver 중단
- Drag listener 제거
- Recent 숨김 해제
- 원본 ChatGPT UI 표시

평상시에는 탭 새로고침 없이 즉시 복구한다. 표시 상태는 이 기기의 `chrome.storage.local`에 보존하며, 팝업에서 다시 ON으로 바꿀 수 있다.

Chrome의 확장 관리 카드에서 확장을 OFF로 바꾸면 이미 열린 탭의 주입 코드와 DOM 변경을 Chrome이 즉시 철회하지 않는다. 이 경우 ChatGPT 탭을 새로고침해 원본 UI를 복구한다. 카드를 다시 ON으로 바꾼 뒤에도 ChatGPT 탭을 새로고침해 GSM을 적용한다.

저장 데이터는 삭제하지 않는다.

---

# 15. UI 상태 표시

팝업에서 최소 상태 확인 가능:

```text
화면 인식          정상 / 오류
최근 채팅 필터      정상 / 중지
폴더 UI            정상 / 오류
동기화             정상 / 오류
네트워크 인식       꺼짐 / 정상 / 오류
```

복잡한 개발자 디버그 UI는 기본 화면에 노출하지 않는다.

필요하면 고급/개발자 섹션으로 분리.

---

# 16. 테스트 기준

## 16.1 기본 Recents
- [ ] 프로젝트 미소속 채팅은 Recents에 보인다.
- [ ] 프로젝트 소속이 확정된 채팅은 Recents에서 숨겨진다.
- [ ] 미확인 채팅은 숨겨지지 않는다.
- [ ] 팝업의 GSM 표시 OFF 시 모든 원본 Recents가 즉시 복구된다.
- [ ] Chrome 확장 카드 OFF 후 탭 새로고침 시 원본 Recents가 복구된다.

## 16.2 폴더
- [ ] 프로젝트별 독립 폴더 생성.
- [ ] 폴더 rename.
- [ ] 폴더 삭제 → 채팅을 프로젝트 바로 아래에 표시.
- [ ] 폴더 미지정 채팅에 별도 시스템 폴더를 만들지 않는다.
- [ ] 프로젝트 A의 폴더가 프로젝트 B에 섞이지 않는다.

## 16.3 Safe Drag
- [ ] 같은 프로젝트 내 폴더 이동.
- [ ] 프로젝트 바로 아래 ↔ 폴더.
- [ ] 채팅 순서 변경.
- [ ] 폴더 순서 변경.
- [ ] 잘못된 drop target → 원래 위치 유지.
- [ ] 프로젝트 밖 drop → 기본모드에서 아무 동작 없음.

## 16.4 Full Drag
- [ ] 옵션 OFF에서는 비활성.
- [ ] 옵션 ON에서만 프로젝트 이동 가능.
- [ ] 실제 ChatGPT 이동 성공 전 GSM 로컬 상태를 확정하지 않는다.
- [ ] 실패 시 롤백.
- [ ] Safe Drag에 영향 없음.

## 16.5 동기화
집 PC에서:
- 폴더 생성
- 채팅 분류
- 옵션 변경

회사 PC에서:
- Chrome Sync 후 동일 상태 확인

반대 방향도 테스트.

## 16.6 학습
- [ ] 프로젝트 방문 시 자동 학습.
- [ ] 재방문 시 증분 갱신.
- [ ] 현재 프로젝트 다시 읽기.
- [ ] 미학습 프로젝트 일괄학습.
- [ ] 모든 프로젝트 다시 학습.
- [ ] 캐시 초기화 후 폴더 정리 정보 유지.

## 16.7 장애
- [ ] Adapter가 사이드바를 못 찾으면 Fail-Open.
- [ ] 잘못된 conversation 숨김 없음.
- [ ] MutationObserver 무한 루프 없음.
- [ ] B 실패 시 A+C 정상.
- [ ] Cross-project drag 실패 시 Safe Drag 정상.
- [ ] 팝업의 GSM 표시 OFF 시 원본 즉시 복원.
- [ ] Chrome 확장 카드 OFF/ON 반복 시 탭 새로고침 후 각 화면 복원.

---

# 17. 개발 순서 권장

한 번에 전부 만들지 말고, 아래 순서로 각 단계마다 테스트를 통과한 뒤 다음 단계로 진행한다.

### Phase 1 — Adapter / ID 수집
- ChatGPTAdapter
- 프로젝트/채팅 ID 탐지
- DOM 변경 관찰
- Fail-Open

### Phase 2 — Membership / Registry
- DomMembershipProvider
- MembershipRegistry
- local cache
- Recents 필터

### Phase 3 — GSM Folder UI
- 독립 Sidebar Root
- 1단계 폴더
- 폴더 미지정 채팅을 프로젝트 바로 아래에 표시
- 폴더 CRUD
- 접기/펼치기

### Phase 4 — Sync
- chrome.storage.sync
- local cache 분리
- migration/versioning
- 충돌처리

### Phase 5 — Safe Drag
- 채팅 폴더 이동
- 채팅 순서
- 폴더 순서
- invalid drop rollback

### Phase 6 — 학습 관리
- 현재 프로젝트 다시 읽기
- A+C 기반 일괄학습
- 캐시 초기화

### Phase 7 — Network Provider
- 실험 옵션
- 수동적 응답 관찰
- A와 결과 병합
- 실패 격리
- 설정을 바꾸지 않는 `[B 지금 다시 확인]` 일회성 동작
- Phase 6 일괄학습에 B 관찰 연결

### Phase 8 — Full Drag
- 실험 옵션
- 실제 ChatGPT 프로젝트 이동
- 성공 확인
- transaction/rollback

### Phase 9 — 안정화
- DOM 변화 테스트
- 긴 Recents
- 다수 프로젝트
- 다수 폴더
- Chrome Sync 양방향
- 확장 OFF/ON 반복
- 팝업의 GSM 표시 OFF/ON 반복과 원본 즉시 복원
- reload / SPA navigation

---

# 18. Codex 작업 규칙

1. **기능을 임의로 추가하지 않는다.**
2. 요구사항에 없는 대규모 프레임워크/서버/DB를 도입하지 않는다.
3. ChatGPT DOM 접근은 Adapter 외부에서 금지.
4. 원본 ChatGPT DOM과 사용자 데이터를 비파괴적으로 취급한다.
5. 실험 기능은 기본 기능과 결합하지 않는다.
6. 실패 시 자동 폴백 또는 Fail-Open.
7. 모든 쓰기 작업은 성공 검증 후 확정.
8. 제목 기반 식별 금지.
9. external network / telemetry 금지.
10. 새로운 설계 변경이 필요하면 구현 전에 이유와 영향 범위를 설명하고 사용자 승인 후 진행.
11. Phase 단위로 구현하고, 각 Phase 완료 후 테스트 결과를 먼저 보고한다.
12. 중간에 기능을 임의로 확장하지 않는다.

---

# 19. 최초 Codex 요청문

아래처럼 시작한다.

> 현재 폴더는 `GSM` 프로젝트이며, 첨부된 `GSM_SPEC.md`가 제품 요구사항의 기준 문서다.
>
> 먼저 코드를 작성하지 말고 다음을 수행해줘.
>
> 1. 명세 전체를 읽고 기능/비기능 요구사항을 요약한다.
> 2. 구현상 위험요소와 ChatGPT 웹 DOM 의존 지점을 식별한다.
> 3. Manifest V3 기준 파일/모듈 구조를 제안한다.
> 4. Phase 1~9 구현 계획을 명세와 대조하여 검토한다.
> 5. 명세와 충돌하거나 기술적으로 불가능/불안정한 부분이 있으면 임의 변경하지 말고 먼저 보고한다.
> 6. 설계 검토가 끝나면 Phase 1부터 구현한다.
> 7. 각 Phase마다 코드 작성 → 자체 테스트 → 결과 보고 후 다음 Phase로 진행한다.
>
> 특히 다음 원칙은 절대 위반하지 않는다.
>
> - ChatGPT DOM 접근은 Adapter 계층 외부에서 금지.
> - 원본 ChatGPT 데이터/DOM 비파괴.
> - 프로젝트 membership이 불확실한 채팅을 Recents에서 숨기지 않는다.
> - ChatGPT UI 인식 실패 시 Fail-Open.
> - 대화 본문/인증 토큰/쿠키 저장 금지.
> - Network Provider와 Full Drag는 실험 기능이며 기본 기능과 실패 경로를 분리한다.
> - 사용자가 승인하지 않은 기능 추가나 범위 확대를 하지 않는다.

---

# 20. 완료 조건

v1 완료는 아래 상태를 의미한다.

```text
공식 ChatGPT 프로젝트 유지
       +
프로젝트 채팅 Recents 자동 숨김
       +
프로젝트별 1단계 GSM 폴더
       +
프로젝트 바로 아래의 폴더 미지정 채팅
       +
Safe Drag
       +
Chrome Sync
       +
DOM 학습
       +
초기/재학습 도구
       +
Fail-Open
       +
기기별 GSM 표시 ON/OFF
       +
Network Provider 옵션
       +
Full Drag 옵션
```

기본 기능이 안정적으로 동작한 뒤에만 실험 옵션을 활성화한다.

# 추가 구현 지시: 최근 채팅 다중선택·일괄삭제 (2026-09-27)

사용자가 별도 개발 지시서로 승인한 추가 범위다. 아래 항목은 기존 기본 기능의 비파괴 원칙에 대한 **사용자가 명시적으로 확인한 채팅 삭제 동작만의 예외**이며, 기존 원본 표시·폴더·분류·이동 방식은 유지한다.

- 최근 목록에 선택 모드 진입 버튼을 제공한다. `NORMAL / SELECTING / BATCH_DELETING` 상태를 분리한다.
- 행 전체 클릭 toggle, Shift+클릭 범위 추가선택, 왼쪽 버튼을 누른 채 쓸기(add-only)를 제공한다. ID 기반 선택/anchor/Queue는 일시 메모리 상태이며 Sync하지 않는다.
- 선택/삭제 중 Safe Drag·Full Drag를 차단하고 종료 시 복원한다. Queue와 충돌하는 학습·메뉴·화면 이동을 제한하거나 작업을 중단한다.
- GSM 확인은 전체 Queue 시작 전 1회다. 원본 확인창 실측(2026-09-27)의 오른쪽 정렬 `취소 → 삭제`, 12px 간격, 둥근 버튼을 따른다. 위험 버튼에 빨간색과 전체 개수를 표시한다.
- Adapter에서 현재 ID에 해당하는 원본 메뉴·삭제 확인창을 다시 찾아 순차 삭제한다. 제목은 확인창 교차검증에만 사용하고 식별키로 사용하지 않는다. 인증정보 수집·비공개 API 직접 호출·외부 의존성은 추가하지 않는다.
- 다음 항목은 원본 확인창 종료와 최근 목록의 ID 소실을 확인한 뒤 시작한다. 시간 제한·대상 변경·탐색 실패·결과 불명 시 실패를 표시하고 Queue를 중단한다. 임의 재시도나 삭제 성공 기록 조작은 하지 않는다.
- 중지는 이미 확정한 한 건을 되돌리지 않는다. 남은 항목을 실행하지 않고 NORMAL로 복귀한다. 전체 캐시/분류 저장소를 초기화하지 않는다.
- Library, 프로젝트/사용자 폴더 다중선택, 일괄 이동·보관, 휴지통·Undo, 자동 스크롤, 전체 기록 수집, 백그라운드 재개는 제외한다.
- 기존 전체 자동 테스트와 신규 선택/삭제/충돌 테스트를 실행하고, 실제 브라우저 검증 범위를 별도로 보고한다. 실제 삭제 금지라는 현재 검증 지시를 따른다.
