-- REG-03 (25/11) · Occurrence reporting (EU) 376/2014 and Occurrence classification (EU) 2015/1018 are both published by EASA in one
-- Easy Access Rules document ("Easy Access Rules for Occurrence Reporting", which also holds 2020/2034 and 2021/2082). Read from that
-- EASA page like the other EARs, so "Check EASA now" finds their version instead of leaving them to be recorded by hand.
update regulations set kind = 'ear', title = 'Easy Access Rules for Occurrence Reporting (Regulation (EU) No 376/2014)',
  page_url = 'https://www.easa.europa.eu/en/document-library/easy-access-rules/occurrence-reporting-rule-book-easy-access-rules',
  check_result = null, check_note = null
where key in ('occurrence-reporting', 'occurrence-classification');
