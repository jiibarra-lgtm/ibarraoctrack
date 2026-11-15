/** Jurisdicción probable por el nombre del cliente (después se confirma a mano). */
export function guessJurisdiction(name: string, doc: string | null) {
  const n = name.toUpperCase();
  if (doc === "34999032089" || /CIUDAD (AUT[OÓ]NOMA )?DE BUENOS AIRES|GCBA|\bIVC\b|INSTITUTO DE VIVIENDA DE LA CIUDAD|TRIBUNAL SUPERIOR|CONSEJO DE LA MAGISTRATURA.*CIUDAD|LEGISLATURA.*CIUDAD|JUSBAIRES|AUTOPISTAS URBANAS|SUBTERR[AÁ]NEOS DE BUENOS AIRES|POLIC[IÍ]A DE LA CIUDAD|HOSPITAL.*(CIUDAD|GCBA)/.test(n)) return "CABA";
  if (/MISIONES/.test(n)) return "Misiones";
  if (/SANTA FE/.test(n)) return "Santa Fe";
  if (/PROVINCIA DE BUENOS AIRES|\bPBA\b|BONAERENSE|MUNICIPALIDAD DE (LA PLATA|QUILMES|MORON|LAN[UÚ]S|AVELLANEDA|TIGRE|PILAR|SAN ISIDRO|VICENTE L[OÓ]PEZ)/.test(n)) return "Buenos Aires";
  for (const j of ["C[OÓ]RDOBA:Córdoba", "MENDOZA:Mendoza", "TUCUM[AÁ]N:Tucumán", "SALTA:Salta", "JUJUY:Jujuy", "CHACO:Chaco", "CORRIENTES:Corrientes", "ENTRE R[IÍ]OS:Entre Ríos", "NEUQU[EÉ]N:Neuquén", "R[IÍ]O NEGRO:Río Negro", "CHUBUT:Chubut", "SAN JUAN:San Juan", "SAN LUIS:San Luis", "LA PAMPA:La Pampa", "FORMOSA:Formosa", "CATAMARCA:Catamarca", "LA RIOJA:La Rioja", "SANTA CRUZ:Santa Cruz", "SANTIAGO DEL ESTERO:Santiago del Estero", "TIERRA DEL FUEGO:Tierra del Fuego"]) {
    const [re, label] = j.split(":");
    if (new RegExp(re).test(n)) return label;
  }
  if (/NACI[OÓ]N|MINISTERIO DE|ANSES|PAMI|INSTITUTO NACIONAL|UNIVERSIDAD NACIONAL|GENDARMER|PREFECTURA|EJ[EÉ]RCITO|ARMADA|FUERZA A[EÉ]REA/.test(n)) return "CABA";
  return "CABA";
}
