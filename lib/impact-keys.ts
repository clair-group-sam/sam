/** certificates a regulation (by key) or a domain bears on */
export const CERT_BY_KEY: Record<string, RegExp> = {
  "air-operations": /\bAOC\b|ops ?spec|operations specification|\bSPA\b|PBN|RVSM|MNPS|HLA|LVO|EFB|dangerous goods|\bDG\b/i,
  "continuing-airworthiness": /CAMO|\bARC\b|airworthiness review|Part[- ]?145|\b145\b|\bAMP\b|maintenance programme/i,
  "initial-airworthiness": /\bC of A\b|CofA|certificate of airworthiness|noise|type certificate|permit to fly|EASA Form/i,
  aircrew: /\bATO\b|FSTD|licen[cs]e|training organi[sz]ation/i,
  "aeroplane-fstd": /FSTD|simulator|\bFNPT\b|\bFFS\b/i,
  "information-security": /Part[- ]?IS|ISMS|information security/i,
  "basic-regulation": /\bAOC\b|CAMO|\bATO\b|Part[- ]?145/i,
  "cs-mmel": /\bMEL\b|MMEL/i, "cs-gen-mmel": /\bMEL\b|MMEL/i,
};
