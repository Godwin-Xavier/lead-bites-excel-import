# Data Verification Report — Strategic_Client_Engagement_17_Jun_26.xlsx

**Scope:** 814 contact rows, 37 accounts, 13 columns. Cross-checked name ↔ email ↔ LinkedIn ↔ company, duplicate detection, and per-company field consistency.
**Verdict:** the core data is largely sound — 589 usable emails, and almost all match the contact's name and the company's email pattern. But the consolidation did introduce real errors: **30 contacts are in the sheet twice** (several with conflicting emails/titles between the two copies), and there are **~15 hard errors** in emails, names, and LinkedIn URLs that will cause bounces or mis-attribution if the list is used as-is.

All row numbers below are **Excel row numbers** in the original sheet. The companion file `Strategic_Client_Engagement_17_Jun_26_REVIEWED.xlsx` has every issue color-highlighted with an explanatory comment, plus a **QA Findings** sheet listing all of them (filterable). No data values were changed.

**Color legend in the reviewed file:**
- 🔴 Red = hard error, fix before using
- 🟠 Orange = duplicated contact (whole row)
- 🔵 Blue = company field inconsistent with the company's other rows
- 🟡 Yellow = contact's location doesn't match the region block — please confirm intent

---

## 1. Hard errors (red) — fix before using the list

### Emails that will bounce or reach the wrong place
| Row | Company | Contact | Problem |
|---|---|---|---|
| 14 | Microsoft | Marta Ordoño Villanueva | `martaordvi@gmail.com` — a personal Gmail in a corporate lead list |
| 170 | L'Oreal | Natasha Maharaj | `natasha. maharaj@loreal.com` — stray space after the dot |
| 204 | Ralph Lauren | Yvette Lam | `Yvette.Lam @ralphlauren.com` — space before @ |
| 427 | DHL | Serkan Timur | `Serkan.Timur @dhl.com` — space before @ |
| 510 | Procter & Gamble | Armando Trujillo Papachoris | space inside the local part |
| 531 | Heineken | Cecilia Bottai Mondino | space inside the local part |
| 607 | Estee Lauder | Venus Lam | two addresses in one cell (`VLam@estee.com` + `vlam@hk.estee.com`) — keep one |
| 796 | Astrazeneca | Daisy Cai | `daisy .cai@astrazeneca.com` — stray space |
| 116 | Adobe | Stacy Martinet | `smartinet@abobe.com` — domain typo, should be `@adobe.com` |
| 326 | Adobe | Elodie C. | `EC@adobe.com` looks constructed from the anonymised LinkedIn display name — unlikely to be real |

### Name / email / LinkedIn don't agree (possible copy-paste from the wrong row)
| Row | Company | What doesn't match |
|---|---|---|
| 244 | Citizens Financial Group | Name says "Natalie **Bagely**" but email (`natalie.bagley@`) and LinkedIn (`/nataliebagley`) say **Bagley** — the name cell is the typo. Same row also says Global HQ = "**Netherlands**" while all other Citizens rows say Rhode Island. This row was clearly corrupted during editing. |
| 197 | Ralph Lauren | Contact is "Juliette W." but the LinkedIn URL is `/dalewwilkinson` — a different person's profile. |
| 675 | Schneider Electric | Name says "Jaya **Moorthi**" but email (`jaya.pillai@`) and LinkedIn (`/jaya-pillai`) both say **Pillai** — verify the surname. |
| 125 | Adobe | "Gaelle **Villie**" is a typo — her LinkedIn and duplicate row 324 (`GVillier@adobe.com`) say **Villier**. |
| 179 vs 612 | Estee Lauder | Maura Sauchelli appears twice with **two different emails**: `msauchel@estee.com` (179) vs `MSauchelli@estee.com` (612). Other estee.com addresses keep the full surname (`jebrahimian@`, `mottenheimer@`…), so the 612 version is more plausible — verify. |
| 778 | Mondelez | "Vira Ponomarenko" but LinkedIn is `/veragumenyuk` — could be a maiden/married name, but confirm it's the same person. |

### Typos in category fields
- 19 PriceWaterhouseCoopers rows have Sector = "**Profesional** Services" (should be "Professional").

## 2. Duplicated contacts (orange) — 30 people appear twice

The tell-tale consolidation artifact: whole blocks got pasted into two different region sections. Worst case: **Estee Lauder's AMS contact list (rows ~172–189) was pasted again into the JAPAC section (rows ~610–628)** — 19 USA-based contacts sitting in the JAPAC block. Where the two copies disagree (title, email, LinkedIn), someone edited one copy after the split, so the differences must be reconciled, not just deleted blindly.

| Contact | Company | Rows | Copies disagree on |
|---|---|---|---|
| Jennifer Antczak | Coca-Cola | 71, 735 | Region, Sector, HQ, Countries, Designation, LinkedIn, Email, Responsibilities |
| Jenna Feng | Coca-Cola | 74, 740 | Region, Sector, HQ, Countries, LinkedIn, Email, Responsibilities |
| Yue Yokoyama | Coca-Cola | 78, 737 | Region, Sector, HQ, Countries, Designation, LinkedIn, Email, Responsibilities |
| Michael Benjamin | Adobe | 120, 319 | Region, HQ, Countries, Location, LinkedIn, Email, Responsibilities |
| Jamie Brighton | Adobe | 122, 322 | Region, HQ, Countries, LinkedIn, Email, Responsibilities |
| Gaelle Villie(r) | Adobe | 125, 324 | Region, HQ, Countries, **Name spelling**, LinkedIn, Email, Responsibilities |
| Katja Dollinger | Adobe | 126, 323 | Region, HQ, Countries, LinkedIn, Email, Responsibilities |
| Anindita Veluri | Adobe | 132, 605 | Region, HQ, Countries, Designation, LinkedIn, Responsibilities |
| Saarthak Malik | Estee Lauder | 172, 625 | Region, HQ, Location, LinkedIn, Responsibilities |
| Nicole Lucas | Estee Lauder | 175, 614 | Region, HQ, Location, LinkedIn, Responsibilities |
| Jennifer Johns | Estee Lauder | 176, 626 | Region, HQ, Location, LinkedIn, Responsibilities |
| Maura Sauchelli | Estee Lauder | 179, 612 | Region, HQ, Location, **Email**, Responsibilities |
| Ryan Toomey | Estee Lauder | 189, 615 | Region, HQ, Location, LinkedIn, Responsibilities |
| Igor De Castro Oliveira | Heineken | 236, 530 | Region, Designation, LinkedIn, Responsibilities |
| Adriana Teixeira | Heineken | 242, 528 | Region, LinkedIn, Email, Responsibilities |
| Karen Gabriela Lopez Mota | Heineken | 243, 538 | Region, LinkedIn, Responsibilities |
| Leandro Barreto | Unilever | 296, 715 | Region, HQ, Designation, Location, Responsibilities |
| Tati Lindenberg | Unilever | 300, 718 | Region, HQ, Location, Responsibilities |
| Andrew Decker | Unilever | 311, 717 | Region, HQ, Designation, LinkedIn, Responsibilities |
| Vipul Patil | Unilever | 312, 722 | Region, HQ, Designation, LinkedIn, Responsibilities |
| Rodrigo Galan Amieva | Heineken | 520, 533 | Responsibilities only |
| Benjamin Lambert | Johnson & Johnson | 576, 580 | **Location (UK vs France)**, Responsibilities |
| Antoine Leflamanc / "Antoine L." | DFI Retail Group | 588, 595 | Name form, Email (595 has none) |
| Yinghua (Grace) XU | Schneider Electric | 677, 698 | exact duplicate — delete one |
| Chen ZHANG | Mondelez | 750, 755 | exact duplicate — delete one |
| Shamus Xiangming Qu | Mondelez | 751, 756 | exact duplicate — delete one |
| Celina Zhao | Mondelez | 752, 757 | exact duplicate — delete one |
| Holly Yuan | Mondelez | 753, 758 | exact duplicate — delete one |
| Zhou Chunfang | Beiersdorf | 783, 788 | exact duplicate — delete one |
| Priyanka Agarwal | Beiersdorf | 786, 791 | exact duplicate — delete one |

## 3. Company fields describing the same company differently (blue)

Different contributors described the same account differently — cosmetic, but it will fragment any pivot/filter:

- **Sector:** Coca-Cola is "CPG" in the AMS block but "FMCG" in JAPAC. Estee Lauder is "FMCG" in AMS/JAPAC but "Luxury & Beauty" in EMEA. Also "Financial services" vs "Financial Services" (case).
- **Global HQ:** Adobe = "United States" / "California" / "San Jose, California" (3 variants). Estee Lauder = 3 variants, Unilever and Coca-Cola = 2 each.
- **Countries/Regions Focused:** Adobe (3 variants), Coca-Cola, Estee Lauder, Uniqlo (2 each).

The minority-variant cells are highlighted blue in the reviewed file (160 cells).

## 4. Region block vs contact location (yellow) — please confirm

The sheet is organised in three blocks (AMS rows 2–281, EMEA ~282–555, JAPAC ~556–815), but **271 rows have a contact based outside the block's region** — e.g., all of Microsoft sits under AMS including its Japan/Germany/Hong Kong contacts, and all of Astrazeneca sits under JAPAC including 11 USA contacts. If "Region" means *the account team's region*, these are fine; if it should match the contact, they need re-sorting. Flagged in light yellow so you can judge — the duplicates in section 2 are the cases where this definitely went wrong.

## 5. Data hygiene (no highlight, worth a pass before any import)

- **225 of 814 rows (28%) have no usable email** (blank or "NA"). Biggest gaps: Coca-Cola (28), Heineken (19), GlaxoSmithKline (18), Adobe (17), Ralph Lauren (15).
- Stray leading/trailing spaces: 113 contact names, 121 emails, 277 designations — run TRIM before importing to a CRM (trailing spaces make emails fail validation in many tools).
- Missing values: Sector (row 761), Contact's Location (row 458), LinkedIn URL (rows 190, 195).
- "Still with the same organization" is "Yes" on **all 814 rows** — statistically unlikely and impossible to verify from the file; treat as unvalidated.
- Note: "GlaxoSmithKline" and "GlaxoSmithKline Publicis" are listed as separate accounts (the latter's 4 rows have no emails) — confirm that's intentional.

## What checked out fine ✅

- Every usable email's **domain matches its company** (incl. legitimate regional domains: `elceurope.com`/`hk.estee.com` for Estee, `heinekenusa.com`/`heineken.com.br`, `ccbji.co.jp` for Coca-Cola Japan, `fastretailing.com` for Uniqlo, `virginmediao2.co.uk` for O2, `citizensbank.com` for Citizens). Only exceptions: the Gmail and `abobe.com` rows above.
- Aside from the cases in section 1, **email local parts match contact names**, following each company's own pattern (e.g., `first.last@` at Unilever/Heineken, first-initial+surname at Adobe/Estee).
- LinkedIn slugs match contact names everywhere except the flagged rows (Chinese-name profiles like `/春芳-周` for Zhou Chunfang were verified as matching).
- No contact appears under the wrong company, and no cross-company row bleed was detected.

## Suggested next steps

1. Fix the red cells (10 email fixes, 3 name spellings, 2 LinkedIn verifications).
2. De-duplicate the 30 orange contacts — for the 23 non-identical pairs decide which copy wins (usually the one whose email/LinkedIn agrees with the company pattern).
3. Align the blue company-metadata variants (pick one canonical Sector/HQ/Countries per account).
4. Confirm the Region-column convention and re-sort or ignore the yellow rows accordingly.
5. Bulk-TRIM whitespace before any CRM import.
