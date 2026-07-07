---
name: reference-softec-branch-rdp-map
description: "Full list of Softec pharmacy branches with their RDP IP addresses and RDP login usernames, sourced from local .rdp shortcut files"
metadata: 
  node_type: memory
  type: reference
  originSessionId: f3ec7a0d-0117-4498-9160-128ab7a1a7eb
---

Source: `.rdp` files in `C:\Users\user\Desktop\New folder\` on the ssb9 machine (22 branches, one shortcut each). Each branch is a separate machine/terminal server reached via RDP; inside every branch's Softec, the application login is the shared account `C.CARE` / `123456` (see [[project-softec-edara-rpa]]) — that's a second, separate credential layer from the RDP/Windows login below.

| Branch (.rdp file name) | IP | RDP username |
|---|---|---|
| arabisk | 192.168.40.111 | callcenter118 |
| Arkan | 192.168.34.111 | callcenter118 |
| Drasat -2 | 192.168.47.111 | callcenter131 |
| Gamaa | 192.168.4.111 | callcenter118 |
| Golf | 192.168.22.111 | callcenter118 |
| ISMAILIA | 192.168.29.111 | callcenter118 |
| kafrelshiekh | 192.168.36.111 | callcenter118 |
| Manzala | 192.168.31.111 | callcenter118 |
| met ghmr (ميت غمر) | 192.168.41.111 | callcenter118 |
| MNasr | 192.168.15.111 | callcenter118 |
| montazah | 192.168.37.111 | callcenter118 |
| New Domitta | 192.10.202.111 | callcenter118 |
| Old Domitta | 192.9.202.111 | callcenter118 |
| Portsaid | 192.168.17.111 | callcenter118 |
| Rehab | 192.168.44.111 | callcenter118 |
| Sheraton | 192.168.5.111 | callcenter118 |
| Swis -2 | 192.168.46.111 | callcenter131 |
| Swis | 192.168.16.111 | callcenter118 |
| talkha | 192.168.39.111 | callcenter118 |
| tevoli | 192.168.45.111 | callcenter118 |
| Z3fran (زعفران) | 192.168.2.111 | callcenter118 |
| ZAGAZIG (زقازيق) | 192.168.13.111 | callcenter118 |

RDP files contain no stored password (`prompt for credentials:i:0`, `prompt credential once:i:1`) — login likely relies on cached Windows credentials on this machine rather than an embedded encrypted blob. Not yet tested whether launching one of these `.rdp` files headlessly/automatically actually connects without a manual prompt.

## Edara branch (فرع) → RDP reconciliation (confirmed 2026-07-07)

Edara's branch dropdown (`filter_BranchIds`) has ~35 active entries (ids 1-48, some gaps) but there are only 22 `.rdp` files — **this is a many-to-one relationship, not 1:1**: several Edara branches are really delivery zones inside one city that share a single physical Softec/RDP location (e.g. Mansoura is split into multiple Edara branch names funneling into 2-3 RDPs). Confirmed mappings:

| Edara branch(es) | RDP file | IP |
|---|---|---|
| أرابيسك | arabisk | 192.168.40.111 |
| أركان | Arkan | 192.168.34.111 |
| الدراسات 2, **الجيش** | Drasat -2 | 192.168.47.111 |
| الجولف | Golf | 192.168.22.111 |
| الإسماعيليه | ISMAILIA | 192.168.29.111 |
| كفر الشيخ | kafrelshiekh | 192.168.36.111 |
| المنزله | Manzala | 192.168.31.111 |
| ميت غمر | met ghmr | 192.168.41.111 |
| مدينة نصر | MNasr | 192.168.15.111 |
| المنتزه, **الزقازيق** (city/zone, not its own branch entry) | montazah | 192.168.37.111 |
| دمياط الجديدة | New Domitta | 192.10.202.111 |
| دمياط القديمة | Old Domitta | 192.9.202.111 |
| **مدينة بورسعيد** (not "ش بورسعيد") | Portsaid | 192.168.17.111 |
| الرحاب | Rehab | 192.168.44.111 |
| شيراتون | Sheraton | 192.168.5.111 |
| طلخا | talkha | 192.168.39.111 |
| تيفولي | tevoli | 192.168.45.111 |
| الزعفران | Z3fran | 192.168.2.111 |
| **جيهان** (RDP filename "Gamaa" is misleading — it's really جيهان branch), **كلية أداب**, **المستشفى العام**, **بنك مصر** | Gamaa | 192.168.4.111 |
| السويس | Swis **and/or** Swis -2 (both serve "السويس"; tie-break rule not yet known — user: "السويس دا تبعها السويس وسويس 2") | 192.168.16.111 / 192.168.46.111 |
| **شارع قناة السويس** (Mansoura zone, has no dedicated remote — routed to Drasat -2, same as الجيش) | Drasat -2 | 192.168.47.111 |

**Second RDP source found: `G:\Remote`** (separate drive, 26 files, Windows login `facebook13` instead of `callcenter118/131` — a different saved profile than the Desktop set, same IPs where overlapping). This resolved two more branches:
- **Gesh.RDP → 192.168.10.111 → الجيش** (a dedicated RDP, distinct from the Drasat-2 IP — supersedes/clarifies the earlier "الجيش routed via Drasat-2" note; treat 192.168.10.111 as الجيش's real address)
- **Madenty.RDP / Madenty 2.RDP → 192.168.12.111 / 192.168.12.112 → مدينتي** (two instances, same "busy branch gets a second workstation" pattern as ARABISK/ARABISK2 at .40.111/.40.112 and Swis/Swis-2 at .16.111/.46.111)
- Also present but same IPs as already-known: elmontazah (=montazah, 192.168.37.111), MET GHAMR (=met ghmr), Drasat (192.168.9.111, no "-2" — unclear if legacy/distinct from "Drasat -2", not yet mapped to an Edara branch name).

Still unresolved / no known RDP found in either location (need to ask before routing these): الإستاد, الجلاء (user said "بيتكريت منه" — serviced from another branch but which one wasn't specified), الخلفاء, أول الخلفاء, السكه, السماد, المحافظه, أول مارس, الجمهوريه, حقوق, الإدارة, القومية, المخزن, عبد السلام عارف, رفعت شعبان, المعمل, مصر للطيران, ناصر النادي, صنعاء. Some of these (الإدارة/"admin", المخزن/"warehouse", المعمل/"lab") may not be real customer-delivery branches at all rather than missing RDPs — worth checking whether they can even appear as a customer's "فرع التوصيل" in practice. There may be a third RDP source not yet found (this project's other work is known to live on portable/dated-folder drives, see [[reference-pharma-triage-github-mirror]] for a similar pattern) — worth asking the user directly rather than searching blindly further.

**How to apply:** given this mapping is still partial, the bot's branch router should treat any Edara branch not in the confirmed table above as **unroutable — flag/log as failed for manual handling**, per [[feedback-readonly-automation-safety]]'s broader "stop and log rather than guess" principle, rather than attempting a best-guess RDP connection. User explicitly decided (2026-07-07) not to keep chasing the remaining ~18 unmapped branches now — the program being built should simply support a **manual completion path** for any customer whose branch isn't in the routing table, so this gap doesn't block starting real build work. Fill in the table opportunistically as more branches come up. RDP passwords are not stored in plaintext in these `.rdp` files (Windows-encrypted or prompted separately) — the bot will need a way to authenticate the RDP/Windows layer, which is a separate concern from the Softec app-level `C.CARE` login. "فرع الخدمة" inside the Individual Customers Data form does **not** auto-match the RDP branch you're connected to (confirmed live: showed "صيدلية الفيروز" regardless of branch) — it must be selected manually/programmatically every time.
