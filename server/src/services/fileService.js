const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { stringify } = require('csv-stringify/sync');
const { parse } = require('csv-parse/sync');
const { buildEventStableKey, buildEnrollmentStableKey, buildTrackedEntityStableKey, buildRowHash } = require('../utils/stableIdentity');

const FORMULA_PREFIXES = ['=', '+', '-', '@'];
const TEMPLATE_SCHEMA_VERSION = '2.0.0';
const TEMPLATE_GENERATOR_VERSION = '2026.04.07';
const TEMPLATE_PRIMARY_ARGB = 'FFFFBB22'; // rgb(255, 187, 34)
const TEMPLATE_SECONDARY_ARGB = 'FFFFEBBD'; // rgb(255, 235, 189)
const TEMPLATE_CELL_ARGB = 'FFD9D9D9'; // rgb(217, 217, 217)
const TEMPLATE_CONTEXT_ARGB = 'FFD6E8FF'; // pre-filled locked context cells (light blue)

function normalizeTemplateLanguage(input) {
  const raw = String(input || 'en').trim().toLowerCase();
  if (['fr', 'fr-fr', 'french', 'francais', 'français'].includes(raw)) return 'fr';
  if (['pt', 'pt-pt', 'pt-br', 'portuguese', 'portugese', 'portuse', 'portugais', 'português'].includes(raw)) return 'pt';
  return 'en';
}

const TEMPLATE_I18N = {
  en: {
    sheetStartHere: 'Start Here',
    sheetDataEntry: 'Data Entry',
    sheetValidation: 'Validation',
    sheetMetadataSnapshot: 'Metadata Snapshot',
    sheetCompletion: 'Completion',
    sheetLists: 'Lists',
    step: 'Step',
    instructions: 'Instructions',
    legend: 'Legend',
    templateType: 'Template Type',
    program: 'Program',
    orgUnitScope: 'Org Unit Scope',
    selectedOrgUnits: 'Selected Org Units',
    language: 'Language',
    layout: 'Layout',
    fillInstruction: 'Go to the Data Entry sheet and fill only the shaded editable input cells. Required fields are marked with * and stronger highlight.',
    doNotEditInstruction: 'Do not edit header rows, hidden key rows, or reference sheets.',
    dateInstruction: 'Dates should be entered as YYYY-MM-DD. Dropdown fields have limited allowed values.',
    reviewInstruction: 'Review the Validation sheet for guidance, then upload from the Import page when your required fields are complete.',
    uploadInstruction: 'After filling rows, upload this file from the Import page.',
    shadedCellsLegend: 'Shaded cells are editable; keep header and metadata rows unchanged.',
    notSelected: 'Not selected',
    allAccessibleUnits: 'All accessible units',
    expectedValueTypeTitle: 'Expected value type',
    chooseFromDropdown: 'Choose a value from the dropdown list.',
    invalidSelectionTitle: 'Invalid selection',
    chooseFromListError: 'Choose a value from the list.',
    dateFormatHint: 'Use format YYYY-MM-DD.',
    invalidDateTitle: 'Invalid date',
    invalidDateError: 'Use a valid date in YYYY-MM-DD format.',
    numericHint: 'Enter a numeric value.',
    invalidNumberTitle: 'Invalid number',
    invalidNumberError: 'Enter a numeric value only.',
    booleanHint: 'Choose true or false.',
    dropdownListType: 'Dropdown list',
    dropdownListTypeHint: 'Dropdown (click cell)',
    invalidValueTitle: 'Invalid value',
    trueFalseOnlyError: 'Choose true or false.',
    sectionHeader: 'Section',
    questionHeader: 'Question',
    keyHeader: 'Key',
    valueTypeHeader: 'Value Type',
    valueHeader: 'Value',
    eventAutoNote: 'Leave as AUTO to generate a valid Event UID during upload.',
    exampleRowNote: 'Example row. Add your entries from the next row.',
    entryRangeEnds: 'Entry range ends above. Need more rows? Download a new template or extend the configured range intentionally.',
    metricHeader: 'Metric',
    notesHeader: 'Notes',
    rowsStartedMetric: 'Rows Started',
    rowsStartedNote: 'Rows where any validation state exists.',
    rowsReadyMetric: 'Rows Ready',
    rowsReadyNote: 'Rows passing required field checks.',
    rowsMissingMetric: 'Rows Missing Required Fields',
    rowsMissingNote: 'Rows needing completion before upload.',
    firstMissingMetric: 'First Missing Required Hint',
    firstMissingNote: 'First missing-field detail captured from Data Entry.',
    templateChecksMetric: 'Template Checks in Data Entry',
    disabledLabel: 'Disabled',
    templateChecksNote: 'Row-level helper columns were removed from Data Entry for cleaner data capture.',
    fieldValidationMatrixTitle: 'Field Validation Matrix',
    fieldValidationMatrixNote: 'Required fields and constraints used by server-side validation.',
    fieldKeyLabel: 'Field Key',
    typeRequiredLabel: 'Type / Required',
    optionSetSampleNote: 'Option set sample or rule notes',
    aggregateRulesTitle: 'Aggregate Dataset Validation Rules',
    aggregateRulesSummary: 'Summary from DHIS2 validation rules linked to this dataset.',
    ruleNameHeader: 'Rule Name',
    descriptionHeader: 'Description',
    instructionHeader: 'Instruction',
    noLinkedRulesMetric: 'No linked rules found',
    noLinkedRulesValue: 'No dataset validation rules were returned by the DHIS2 API for this dataset.',
    noLinkedRulesNote: 'Server-side validation during import still enforces required fields and DHIS2 import report errors.',
    requiredLabel: 'Required',
    optionalLabel: 'Optional',
    dateFormatConstraint: 'Date format: YYYY-MM-DD',
    numericValueConstraint: 'Numeric value',
    allowedTrueFalseConstraint: 'Allowed: true or false',
    typePrefix: 'Type',
    optionSetPrefix: 'Option set',
    keyMetaHeader: 'Key',
    fieldMetaHeader: 'Field',
    datasetContextNote: 'Dataset context (read-only)',
    periodContextNote: 'Period context (read-only)',
    orgUnitContextNote: 'Org unit context (read-only)',
    aocContextNote: 'Optional attribute option combo context',
    completedContextNote: 'Set true if completion should be marked after import.',
    completionDateContextNote: 'Optional completion date (YYYY-MM-DD).',
    useTrueFalseOnly: 'Use true or false only.',
    textType: 'Text',
    longTextType: 'Long Text',
    letterType: 'Letter',
    emailType: 'Email',
    phoneNumberType: 'Phone Number',
    dateType: 'Date',
    dateTimeType: 'Date Time',
    booleanType: 'Boolean',
    trueOnlyType: 'True Only',
    integerType: 'Integer',
    positiveIntegerType: 'Positive Integer',
    negativeIntegerType: 'Negative Integer',
    zeroOrPositiveIntegerType: 'Zero or Positive Integer',
    numberType: 'Number',
    percentageType: 'Percentage',
    unitIntervalType: 'Unit Interval',
    ageType: 'Age',
  },
  fr: {
    sheetStartHere: 'Commencer Ici',
    sheetDataEntry: 'Saisie des Données',
    sheetValidation: 'Validation',
    sheetMetadataSnapshot: 'Aperçu Métadonnées',
    sheetCompletion: 'Achèvement',
    sheetLists: 'Listes',
    step: 'Étape',
    instructions: 'Instructions',
    legend: 'Légende',
    templateType: 'Type de Modèle',
    program: 'Programme',
    orgUnitScope: 'Portée Unité Org',
    selectedOrgUnits: 'Unités Org Sélectionnées',
    language: 'Langue',
    layout: 'Disposition',
    fillInstruction: 'Allez dans la feuille de saisie des données et remplissez uniquement les cellules modifiables ombrées. Les champs obligatoires sont marqués par *.',
    doNotEditInstruction: 'Ne modifiez pas les lignes d en-tête, les lignes de clés cachées ou les feuilles de référence.',
    dateInstruction: 'Les dates doivent être saisies au format AAAA-MM-JJ. Les champs déroulants ont des valeurs limitées.',
    reviewInstruction: 'Consultez la feuille de validation, puis téléversez depuis la page d import lorsque les champs requis sont complets.',
    uploadInstruction: 'Après avoir rempli les lignes, téléversez ce fichier depuis la page d import.',
    shadedCellsLegend: 'Les cellules ombrées sont modifiables; gardez les lignes d en-tête et de métadonnées inchangées.',
    notSelected: 'Non sélectionné',
    allAccessibleUnits: 'Toutes les unités accessibles',
    expectedValueTypeTitle: 'Type de valeur attendu',
    chooseFromDropdown: 'Choisissez une valeur dans la liste déroulante.',
    invalidSelectionTitle: 'Sélection invalide',
    chooseFromListError: 'Choisissez une valeur dans la liste.',
    dateFormatHint: 'Utilisez le format AAAA-MM-JJ.',
    invalidDateTitle: 'Date invalide',
    invalidDateError: 'Utilisez une date valide au format AAAA-MM-JJ.',
    numericHint: 'Saisissez une valeur numérique.',
    invalidNumberTitle: 'Nombre invalide',
    invalidNumberError: 'Saisissez uniquement une valeur numérique.',
    booleanHint: 'Choisissez true ou false.',
    dropdownListType: 'Liste déroulante',
    dropdownListTypeHint: 'Liste (cliquer cellule)',
    invalidValueTitle: 'Valeur invalide',
    trueFalseOnlyError: 'Choisissez true ou false.',
    sectionHeader: 'Section',
    questionHeader: 'Question',
    keyHeader: 'Clé',
    valueTypeHeader: 'Type de Valeur',
    valueHeader: 'Valeur',
    eventAutoNote: 'Laissez AUTO pour générer un UID d événement valide lors du téléversement.',
    exampleRowNote: 'Ligne d exemple. Ajoutez vos entrées à partir de la ligne suivante.',
    entryRangeEnds: 'La plage de saisie se termine ci-dessus. Besoin de plus de lignes? Téléchargez un nouveau modèle ou étendez la plage configurée.',
    metricHeader: 'Indicateur',
    notesHeader: 'Notes',
    rowsStartedMetric: 'Lignes Commencées',
    rowsStartedNote: 'Lignes où un état de validation existe.',
    rowsReadyMetric: 'Lignes Prêtes',
    rowsReadyNote: 'Lignes qui respectent les champs obligatoires.',
    rowsMissingMetric: 'Lignes avec Champs Obligatoires Manquants',
    rowsMissingNote: 'Lignes à compléter avant le téléversement.',
    firstMissingMetric: 'Premier Indice de Champ Manquant',
    firstMissingNote: 'Premier détail de champ manquant capturé depuis la saisie.',
    templateChecksMetric: 'Contrôles du Modèle dans la Saisie',
    disabledLabel: 'Désactivé',
    templateChecksNote: 'Les colonnes d aide par ligne ont été supprimées de la saisie pour une capture plus propre.',
    fieldValidationMatrixTitle: 'Matrice de Validation des Champs',
    fieldValidationMatrixNote: 'Champs requis et contraintes utilisés par la validation côté serveur.',
    fieldKeyLabel: 'Clé du Champ',
    typeRequiredLabel: 'Type / Obligatoire',
    optionSetSampleNote: 'Exemple d options ou notes de règle',
    aggregateRulesTitle: 'Règles de Validation du Jeu de Données Agrégé',
    aggregateRulesSummary: 'Résumé des règles de validation DHIS2 liées à ce jeu de données.',
    ruleNameHeader: 'Nom de la Règle',
    descriptionHeader: 'Description',
    instructionHeader: 'Instruction',
    noLinkedRulesMetric: 'Aucune règle liée trouvée',
    noLinkedRulesValue: 'Aucune règle de validation de jeu de données n a été renvoyée par l API DHIS2.',
    noLinkedRulesNote: 'La validation côté serveur applique toujours les champs obligatoires et les erreurs du rapport DHIS2.',
    requiredLabel: 'Obligatoire',
    optionalLabel: 'Optionnel',
    dateFormatConstraint: 'Format de date: AAAA-MM-JJ',
    numericValueConstraint: 'Valeur numérique',
    allowedTrueFalseConstraint: 'Autorisé: true ou false',
    typePrefix: 'Type',
    optionSetPrefix: 'Jeu d options',
    keyMetaHeader: 'Clé',
    fieldMetaHeader: 'Champ',
    datasetContextNote: 'Contexte du jeu de données (lecture seule)',
    periodContextNote: 'Contexte de période (lecture seule)',
    orgUnitContextNote: 'Contexte de l unité org (lecture seule)',
    aocContextNote: 'Contexte optionnel de combinaison d options d attribut',
    completedContextNote: 'Mettez true si l achèvement doit être marqué après importation.',
    completionDateContextNote: 'Date d achèvement optionnelle (AAAA-MM-JJ).',
    useTrueFalseOnly: 'Utilisez uniquement true ou false.',
    textType: 'Texte',
    longTextType: 'Texte Long',
    letterType: 'Lettre',
    emailType: 'Email',
    phoneNumberType: 'Numéro de Téléphone',
    dateType: 'Date',
    dateTimeType: 'Date Heure',
    booleanType: 'Booléen',
    trueOnlyType: 'Vrai Seulement',
    integerType: 'Entier',
    positiveIntegerType: 'Entier Positif',
    negativeIntegerType: 'Entier Négatif',
    zeroOrPositiveIntegerType: 'Entier Zéro ou Positif',
    numberType: 'Nombre',
    percentageType: 'Pourcentage',
    unitIntervalType: 'Intervalle Unitaire',
    ageType: 'Âge',
  },
  pt: {
    sheetStartHere: 'Comece Aqui',
    sheetDataEntry: 'Entrada de Dados',
    sheetValidation: 'Validação',
    sheetMetadataSnapshot: 'Resumo de Metadados',
    sheetCompletion: 'Conclusão',
    sheetLists: 'Listas',
    step: 'Passo',
    instructions: 'Instruções',
    legend: 'Legenda',
    templateType: 'Tipo de Modelo',
    program: 'Programa',
    orgUnitScope: 'Escopo da Unidade Org',
    selectedOrgUnits: 'Unidades Org Selecionadas',
    language: 'Idioma',
    layout: 'Layout',
    fillInstruction: 'Vá para a folha de entrada de dados e preencha apenas as células editáveis sombreadas. Campos obrigatórios são marcados com *.',
    doNotEditInstruction: 'Não edite linhas de cabeçalho, linhas de chave ocultas ou folhas de referência.',
    dateInstruction: 'As datas devem ser inseridas como AAAA-MM-DD. Campos de lista têm valores limitados.',
    reviewInstruction: 'Revise a folha de validação e, em seguida, envie pela página de importação quando os campos obrigatórios estiverem completos.',
    uploadInstruction: 'Após preencher as linhas, envie este arquivo pela página de importação.',
    shadedCellsLegend: 'Células sombreadas são editáveis; mantenha cabeçalhos e metadados inalterados.',
    notSelected: 'Não selecionado',
    allAccessibleUnits: 'Todas as unidades acessíveis',
    expectedValueTypeTitle: 'Tipo de valor esperado',
    chooseFromDropdown: 'Escolha um valor na lista suspensa.',
    invalidSelectionTitle: 'Seleção inválida',
    chooseFromListError: 'Escolha um valor da lista.',
    dateFormatHint: 'Use o formato AAAA-MM-DD.',
    invalidDateTitle: 'Data inválida',
    invalidDateError: 'Use uma data válida no formato AAAA-MM-DD.',
    numericHint: 'Digite um valor numérico.',
    invalidNumberTitle: 'Número inválido',
    invalidNumberError: 'Digite apenas um valor numérico.',
    booleanHint: 'Escolha true ou false.',
    dropdownListType: 'Lista suspensa',
    dropdownListTypeHint: 'Lista (clique na célula)',
    invalidValueTitle: 'Valor inválido',
    trueFalseOnlyError: 'Escolha true ou false.',
    sectionHeader: 'Seção',
    questionHeader: 'Pergunta',
    keyHeader: 'Chave',
    valueTypeHeader: 'Tipo de Valor',
    valueHeader: 'Valor',
    eventAutoNote: 'Deixe AUTO para gerar um UID de evento válido durante o envio.',
    exampleRowNote: 'Linha de exemplo. Adicione seus registros a partir da próxima linha.',
    entryRangeEnds: 'O intervalo de entrada termina acima. Precisa de mais linhas? Baixe um novo modelo ou amplie o intervalo configurado.',
    metricHeader: 'Métrica',
    notesHeader: 'Notas',
    rowsStartedMetric: 'Linhas Iniciadas',
    rowsStartedNote: 'Linhas com algum estado de validação.',
    rowsReadyMetric: 'Linhas Prontas',
    rowsReadyNote: 'Linhas que passam nas verificações de campos obrigatórios.',
    rowsMissingMetric: 'Linhas com Campos Obrigatórios Faltando',
    rowsMissingNote: 'Linhas que precisam ser concluídas antes do envio.',
    firstMissingMetric: 'Primeira Dica de Campo Obrigatório',
    firstMissingNote: 'Primeiro detalhe de campo ausente capturado da entrada de dados.',
    templateChecksMetric: 'Verificações de Modelo na Entrada de Dados',
    disabledLabel: 'Desativado',
    templateChecksNote: 'Colunas auxiliares por linha foram removidas da entrada para uma captura mais limpa.',
    fieldValidationMatrixTitle: 'Matriz de Validação de Campos',
    fieldValidationMatrixNote: 'Campos obrigatórios e restrições usados na validação do servidor.',
    fieldKeyLabel: 'Chave do Campo',
    typeRequiredLabel: 'Tipo / Obrigatório',
    optionSetSampleNote: 'Amostra do conjunto de opções ou notas de regra',
    aggregateRulesTitle: 'Regras de Validação do Conjunto de Dados Agregado',
    aggregateRulesSummary: 'Resumo das regras de validação do DHIS2 vinculadas a este conjunto de dados.',
    ruleNameHeader: 'Nome da Regra',
    descriptionHeader: 'Descrição',
    instructionHeader: 'Instrução',
    noLinkedRulesMetric: 'Nenhuma regra vinculada encontrada',
    noLinkedRulesValue: 'Nenhuma regra de validação de conjunto de dados foi retornada pela API do DHIS2.',
    noLinkedRulesNote: 'A validação no servidor ainda aplica campos obrigatórios e erros do relatório do DHIS2.',
    requiredLabel: 'Obrigatório',
    optionalLabel: 'Opcional',
    dateFormatConstraint: 'Formato de data: AAAA-MM-DD',
    numericValueConstraint: 'Valor numérico',
    allowedTrueFalseConstraint: 'Permitido: true ou false',
    typePrefix: 'Tipo',
    optionSetPrefix: 'Conjunto de opções',
    keyMetaHeader: 'Chave',
    fieldMetaHeader: 'Campo',
    datasetContextNote: 'Contexto do conjunto de dados (somente leitura)',
    periodContextNote: 'Contexto do período (somente leitura)',
    orgUnitContextNote: 'Contexto da unidade org (somente leitura)',
    aocContextNote: 'Contexto opcional da combinação de opções de atributo',
    completedContextNote: 'Defina true se a conclusão deve ser marcada após a importação.',
    completionDateContextNote: 'Data de conclusão opcional (AAAA-MM-DD).',
    useTrueFalseOnly: 'Use apenas true ou false.',
    textType: 'Texto',
    longTextType: 'Texto Longo',
    letterType: 'Letra',
    emailType: 'Email',
    phoneNumberType: 'Número de Telefone',
    dateType: 'Data',
    dateTimeType: 'Data e Hora',
    booleanType: 'Booleano',
    trueOnlyType: 'Somente Verdadeiro',
    integerType: 'Inteiro',
    positiveIntegerType: 'Inteiro Positivo',
    negativeIntegerType: 'Inteiro Negativo',
    zeroOrPositiveIntegerType: 'Inteiro Zero ou Positivo',
    numberType: 'Número',
    percentageType: 'Percentual',
    unitIntervalType: 'Intervalo Unitário',
    ageType: 'Idade',
  },
};

function t(language, key) {
  const lang = normalizeTemplateLanguage(language);
  return TEMPLATE_I18N[lang]?.[key] || TEMPLATE_I18N.en[key] || key;
}

function templateSheetAliases(key) {
  const values = new Set();
  for (const locale of Object.keys(TEMPLATE_I18N)) {
    const name = TEMPLATE_I18N[locale]?.[key];
    if (name) values.add(name);
  }
  return Array.from(values);
}

function getWorksheetByAliases(workbook, aliases = []) {
  for (const name of aliases) {
    const ws = workbook.getWorksheet(name);
    if (ws) return ws;
  }
  return null;
}

function isArgbDark(argb) {
  if (!argb || argb.length < 8) return false;
  const r = parseInt(argb.slice(2, 4), 16);
  const g = parseInt(argb.slice(4, 6), 16);
  const b = parseInt(argb.slice(6, 8), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
}

function sanitizeSpreadsheetValue(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.length > 0 && FORMULA_PREFIXES.includes(text[0])) {
    return `'${text}`;
  }
  return text;
}

function sanitizeSpreadsheetRow(row) {
  const safe = {};
  for (const [key, value] of Object.entries(row)) {
    safe[key] = sanitizeSpreadsheetValue(value);
  }
  return safe;
}

function normalizeWorksheetValue(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part?.text || '').join('');
    }
    if (Object.prototype.hasOwnProperty.call(value, 'text')) {
      return String(value.text || '');
    }
    if (Object.prototype.hasOwnProperty.call(value, 'result')) {
      return normalizeWorksheetValue(value.result);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'formula')) {
      return '';
    }
    if (Object.prototype.hasOwnProperty.call(value, 'hyperlink')) {
      return String(value.text || value.hyperlink || '');
    }
  }
  return String(value);
}

function readFieldKeysFromMetadataSheet(wb) {
  const metaSheet = getWorksheetByAliases(wb, templateSheetAliases('sheetMetadataSnapshot')) || wb.getWorksheet('Template Meta');
  if (!metaSheet) return null;

  for (let rowNumber = 2; rowNumber <= metaSheet.rowCount; rowNumber++) {
    const key = normalizeWorksheetValue(metaSheet.getCell(rowNumber, 1).value).trim();
    if (key !== 'fieldKeys') continue;

    const rawValue = normalizeWorksheetValue(metaSheet.getCell(rowNumber, 2).value).trim();
    if (!rawValue) return null;
    try {
      const parsed = JSON.parse(rawValue);
      if (!Array.isArray(parsed)) return null;
      return new Set(parsed.map((value) => String(value || '').trim()).filter(Boolean));
    } catch {
      return null;
    }
  }

  return null;
}

function readTemplateMetadataFromSheet(wb) {
  const metaSheet = getWorksheetByAliases(wb, templateSheetAliases('sheetMetadataSnapshot')) || wb.getWorksheet('Template Meta');
  const metadata = {};
  if (!metaSheet) return metadata;

  for (let rowNumber = 2; rowNumber <= metaSheet.rowCount; rowNumber++) {
    const key = normalizeWorksheetValue(metaSheet.getCell(rowNumber, 1).value).trim();
    if (!key) continue;
    metadata[key] = normalizeWorksheetValue(metaSheet.getCell(rowNumber, 2).value).trim();
  }

  return metadata;
}

function buildAggregateCategoryOptionComboMetadata(columns = []) {
  const byFieldKey = {};
  const byDataElement = {};

  for (const column of columns) {
    const key = String(column?.key || '');
    const match = key.match(/^de_([A-Za-z0-9]{11})__coc_([A-Za-z0-9]{11})(?:__.*)?$/);
    if (!match) continue;
    const dataElementId = match[1];
    const categoryOptionComboId = match[2];
    byFieldKey[key] = categoryOptionComboId;
    byDataElement[dataElementId] = categoryOptionComboId;
  }

  return {
    byFieldKey,
    byDataElement,
  };
}

/**
 * Convert JSON data to CSV string.
 */
function jsonToCsv(data) {
  if (!Array.isArray(data) || data.length === 0) return '';
  const columns = Object.keys(data[0]);
  const safeData = data.map((row) => sanitizeSpreadsheetRow(row));
  return stringify(safeData, { header: true, columns });
}

/**
 * Convert JSON data to Excel buffer using ExcelJS.
 */
async function jsonToExcel(data) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');

  if (data.length > 0) {
    const headers = Object.keys(data[0]);
    ws.columns = headers.map((key) => ({ header: key, key, width: 20 }));
    for (const row of data) {
      ws.addRow(sanitizeSpreadsheetRow(row));
    }
  }

  return wb.xlsx.writeBuffer();
}

/**
 * Convert JSON data to a simple PDF report buffer.
 */
function jsonToPdf(data, { title = 'DHIS2 Export' } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: 'A4' });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const rows = Array.isArray(data) ? data : [];
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    doc.fontSize(16).text(title);
    doc.moveDown(0.25);
    doc.fontSize(10).fillColor('#475569').text(`Generated: ${new Date().toISOString()}`);
    doc.text(`Record count: ${rows.length}`);
    doc.moveDown();

    if (rows.length === 0) {
      doc.fontSize(11).fillColor('#111827').text('No records available for the selected filters.');
      doc.end();
      return;
    }

    rows.forEach((row, index) => {
      doc.fontSize(11).fillColor('#0f172a').text(`Record ${index + 1}`, { underline: true });
      const keys = columns.length > 0 ? columns : Object.keys(row || {});
      for (const key of keys) {
        const value = row?.[key];
        const rendered = value === null || value === undefined
          ? ''
          : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);
        doc.fontSize(9).fillColor('#111827').text(`${key}: ${rendered}`);
      }
      doc.moveDown(0.5);
    });

    doc.end();
  });
}

function looksLikeTemplateKey(value) {
  if (!value || typeof value !== 'string') return false;
  const v = value.trim().replace(/\s+\*$/, '');
  const baseKeys = new Set([
    'event', 'status', 'program', 'programStage', 'orgUnit', 'occurredAt', 'trackedEntity', 'enrollment',
    'trackedEntityType', 'enrolledAt', 'scheduledAt', 'eventDate', 'enrollmentDate', 'incidentDate',
    'validationNotes', 'missingRequiredFields', 'rowQualityScore', 'firstIssue',
  ]);
  if (baseKeys.has(v)) return true;
  return /^(de|attr|tea)_[A-Za-z0-9]{11}(?:__.*)?$/.test(v);
}

function detectHeaderRowIndex(ws) {
  const maxRows = Math.min(ws.rowCount || 1, 20);
  let best = { row: 1, score: 0 };

  for (let rowNumber = 1; rowNumber <= maxRows; rowNumber++) {
    const row = ws.getRow(rowNumber);
    const values = row.values.slice(1).map((v) => normalizeWorksheetValue(v).trim()).filter(Boolean);
    if (values.length === 0) continue;
    const hits = values.filter((v) => looksLikeTemplateKey(v)).length;
    const score = hits / values.length;
    if (score > best.score) {
      best = { row: rowNumber, score };
    }
  }

  return best.score >= 0.3 ? best.row : 1;
}

function isLikelyValueTypeRow(values) {
  const knownTypes = new Set([
    'TEXT', 'LONG_TEXT', 'LETTER', 'EMAIL', 'PHONE_NUMBER',
    'DATE', 'DATETIME', 'BOOLEAN', 'TRUE_ONLY',
    'INTEGER', 'INTEGER_POSITIVE', 'INTEGER_NEGATIVE', 'INTEGER_ZERO_OR_POSITIVE',
    'NUMBER', 'PERCENTAGE', 'UNIT_INTERVAL', 'AGE',
  ]);
  const normalized = (values || [])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (normalized.length === 0) return false;
  const hits = normalized.filter((value) => {
    const upper = value.toUpperCase();
    // Recognise DHIS2 value types, context-cell indicators, and dropdown hints as type-row markers
    return knownTypes.has(upper)
      || /^PRE-FILLED/i.test(value)
      || /^DROPDOWN/i.test(value)
      || /^LISTE\s/i.test(value)
      || /^LISTA\s/i.test(value);
  }).length;
  return (hits / normalized.length) >= 0.4;
}

function applyTemplateHeaderStyle(cell, fillColor) {
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: fillColor },
  };
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  cell.font = { bold: true, color: { argb: isArgbDark(fillColor) ? 'FFFFFFFF' : 'FF0F172A' } };
  cell.border = {
    top: { style: 'medium', color: { argb: 'FF0F172A' } },
    left: { style: 'medium', color: { argb: 'FF0F172A' } },
    bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
    right: { style: 'medium', color: { argb: 'FF0F172A' } },
  };
}

function applySheetTitleStyle(cell, fillColor) {
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: fillColor },
  };
  cell.font = { bold: true, color: { argb: isArgbDark(fillColor) ? 'FFFFFFFF' : 'FF0F172A' }, size: 14 };
  cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  cell.border = {
    top: { style: 'medium', color: { argb: 'FF000000' } },
    left: { style: 'medium', color: { argb: 'FF000000' } },
    bottom: { style: 'medium', color: { argb: 'FF000000' } },
    right: { style: 'medium', color: { argb: 'FF000000' } },
  };
}

function applySheetCellStyle(cell, { fillColor = 'FFFFFFFF', fontColor = 'FF0F172A', bold = false, italic = false } = {}) {
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: fillColor },
  };
  cell.font = { color: { argb: fontColor }, bold, italic };
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  };
}

function applyBandingToRange(ws, startRow, endRow, startCol, endCol, { firstFill = TEMPLATE_CELL_ARGB, secondFill = 'FFFFFFFF' } = {}) {
  const neutralBandingFills = new Set([
    'FFFFFFFF',
    TEMPLATE_CELL_ARGB,
    String(firstFill || '').toUpperCase(),
    String(secondFill || '').toUpperCase(),
  ]);

  for (let rowNumber = startRow; rowNumber <= endRow; rowNumber++) {
    const rowFill = rowNumber % 2 === 0 ? secondFill : firstFill;
    for (let colNumber = startCol; colNumber <= endCol; colNumber++) {
      const cell = ws.getCell(rowNumber, colNumber);
      const existingFill = cell.fill;
      if (existingFill && typeof existingFill === 'object' && existingFill.type === 'pattern' && existingFill.fgColor?.argb) {
        const existingArgb = String(existingFill.fgColor.argb || '').toUpperCase();
        if (existingArgb && !neutralBandingFills.has(existingArgb)) {
          continue;
        }
      }

      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: rowFill },
      };
      if (!cell.font) {
        cell.font = { color: { argb: 'FF0F172A' } };
      }
      if (!cell.border) {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
      }
    }
  }
}

function applyRowBandingToUsedRows(ws, firstDataRow, lastDataRow, lastCol) {
  applyBandingToRange(ws, firstDataRow, lastDataRow, 1, lastCol);
}

function getTemplateTheme(dataType) {
  if (dataType === 'aggregate') {
    return {
      cover: TEMPLATE_PRIMARY_ARGB,
      primary: TEMPLATE_PRIMARY_ARGB,
      secondary: TEMPLATE_PRIMARY_ARGB,
      accent: TEMPLATE_PRIMARY_ARGB,
      surface: TEMPLATE_CELL_ARGB,
      surfaceAlt: TEMPLATE_CELL_ARGB,
      muted: TEMPLATE_CELL_ARGB,
      success: 'FFDCFCE7',
      danger: 'FFFEE2E2',
      info: TEMPLATE_SECONDARY_ARGB,
      textOnDark: 'FFFFFFFF',
    };
  }

  if (dataType === 'tracker' || dataType === 'enrollments') {
    return {
      cover: TEMPLATE_PRIMARY_ARGB,
      primary: TEMPLATE_PRIMARY_ARGB,
      secondary: TEMPLATE_PRIMARY_ARGB,
      accent: TEMPLATE_PRIMARY_ARGB,
      surface: TEMPLATE_CELL_ARGB,
      surfaceAlt: TEMPLATE_CELL_ARGB,
      muted: TEMPLATE_CELL_ARGB,
      success: 'FFDCFCE7',
      danger: 'FFFEE2E2',
      info: TEMPLATE_SECONDARY_ARGB,
      textOnDark: 'FFFFFFFF',
    };
  }

  return {
    cover: TEMPLATE_PRIMARY_ARGB,
    primary: TEMPLATE_PRIMARY_ARGB,
    secondary: TEMPLATE_PRIMARY_ARGB,
    accent: TEMPLATE_PRIMARY_ARGB,
    surface: TEMPLATE_CELL_ARGB,
    surfaceAlt: TEMPLATE_CELL_ARGB,
    muted: TEMPLATE_CELL_ARGB,
    success: 'FFECFDF5',
    danger: 'FFFFF1F2',
    info: TEMPLATE_SECONDARY_ARGB,
    textOnDark: 'FFFFFFFF',
  };
}

function columnNumberToName(colNumber) {
  let n = colNumber;
  let name = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function buildOptionListRanges(wb, columns, language = 'en') {
  const rangesByKey = {};
  const optionColumns = (columns || []).filter((col) => Array.isArray(col.options) && col.options.length > 0);
  if (optionColumns.length === 0) return rangesByKey;

  const listSheetName = t(language, 'sheetLists');
  const wsLists = wb.addWorksheet(listSheetName);
  let listCol = 1;

  for (const col of optionColumns) {
    const uniqueOptions = [];
    const seen = new Set();
    for (const raw of col.options) {
      const value = String(raw || '').trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      uniqueOptions.push(value);
    }
    if (uniqueOptions.length === 0) continue;
    uniqueOptions.sort((a, b) => a.localeCompare(b));

    wsLists.getCell(1, listCol).value = String(col.label || col.key || `list_${listCol}`).slice(0, 100);
    uniqueOptions.forEach((value, idx) => {
      wsLists.getCell(idx + 2, listCol).value = value;
    });

    const colLetter = columnNumberToName(listCol);
    const escapedListSheet = String(listSheetName).replace(/'/g, "''");
    rangesByKey[col.key] = `'${escapedListSheet}'!$${colLetter}$2:$${colLetter}$${uniqueOptions.length + 1}`;
    listCol += 1;
  }

  wsLists.state = 'veryHidden';
  return rangesByKey;
}

function isDateValueType(valueType) {
  const type = String(valueType || '').toUpperCase();
  return type === 'DATE' || type === 'DATETIME';
}

function isNumericValueType(valueType) {
  const type = String(valueType || '').toUpperCase();
  return ['INTEGER', 'INTEGER_POSITIVE', 'INTEGER_NEGATIVE', 'INTEGER_ZERO_OR_POSITIVE', 'NUMBER', 'PERCENTAGE', 'UNIT_INTERVAL', 'AGE'].includes(type);
}

function isBooleanValueType(valueType) {
  const type = String(valueType || '').toUpperCase();
  return type === 'BOOLEAN' || type === 'TRUE_ONLY';
}

function isTrueOnlyValueType(valueType) {
  const type = String(valueType || '').toUpperCase();
  return type === 'TRUE_ONLY';
}

function isTextLikeValueType(valueType) {
  const type = String(valueType || '').toUpperCase();
  return ['TEXT', 'LONG_TEXT', 'LETTER', 'EMAIL', 'PHONE_NUMBER'].includes(type);
}

function applyDataValidationForColumn(ws, colIndex, valueType, rowStart, rowEnd, listFormulaRange = null, language = 'en') {
  const valueTypeLabel = formatValueTypeLabel(valueType, language);

  for (let rowNumber = rowStart; rowNumber <= rowEnd; rowNumber++) {
    const cell = ws.getCell(rowNumber, colIndex);

    if (listFormulaRange) {
      cell.dataValidation = {
        type: 'list',
        formulae: [listFormulaRange],
        allowBlank: true,
        showDropDown: false,
        showInputMessage: false,
        promptTitle: t(language, 'dropdownListType'),
        prompt: t(language, 'chooseFromDropdown'),
        showErrorMessage: true,
        errorTitle: t(language, 'invalidSelectionTitle'),
        error: t(language, 'chooseFromListError'),
      };
      continue;
    }

    if (isDateValueType(valueType)) {
      cell.dataValidation = {
        type: 'date',
        operator: 'greaterThan',
        formulae: [new Date('1900-01-01')],
        showInputMessage: false,
        promptTitle: t(language, 'expectedValueTypeTitle'),
        prompt: `${t(language, 'expectedValueTypeTitle')}: ${valueTypeLabel}. ${t(language, 'dateFormatHint')}`,
        showErrorMessage: true,
        errorTitle: t(language, 'invalidDateTitle'),
        error: t(language, 'invalidDateError'),
      };
    } else if (isNumericValueType(valueType)) {
      cell.dataValidation = {
        type: 'decimal',
        operator: 'between',
        formulae: [-999999999, 999999999],
        showInputMessage: false,
        promptTitle: t(language, 'expectedValueTypeTitle'),
        prompt: `${t(language, 'expectedValueTypeTitle')}: ${valueTypeLabel}. ${t(language, 'numericHint')}`,
        showErrorMessage: true,
        errorTitle: t(language, 'invalidNumberTitle'),
        error: t(language, 'invalidNumberError'),
      };
    } else if (isBooleanValueType(valueType)) {
      cell.dataValidation = {
        type: 'list',
        formulae: [isTrueOnlyValueType(valueType) ? '"true"' : '"true,false"'],
        showInputMessage: false,
        promptTitle: t(language, 'expectedValueTypeTitle'),
        prompt: `${t(language, 'expectedValueTypeTitle')}: ${valueTypeLabel}. ${t(language, 'booleanHint')}`,
        showErrorMessage: true,
        errorTitle: t(language, 'invalidValueTitle'),
        error: isTrueOnlyValueType(valueType) ? 'Choose true only.' : t(language, 'trueFalseOnlyError'),
      };
    } else {
      cell.dataValidation = {
        type: 'custom',
        formulae: ['TRUE'],
        allowBlank: true,
        showInputMessage: false,
        promptTitle: t(language, 'expectedValueTypeTitle'),
        prompt: `${t(language, 'expectedValueTypeTitle')}: ${valueTypeLabel}.`,
      };
    }
  }
}

function styleDataEntryCell(cell, required) {
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  };
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: TEMPLATE_CELL_ARGB },
  };
  cell.protection = { locked: false };
}

function sampleForValueType(valueType) {
  const type = String(valueType || 'TEXT').toUpperCase();
  if (type === 'DATE') return 'Example: 2026-04-07 (use date picker/calendar)';
  if (type === 'DATETIME') return 'Example: 2026-04-07T13:30:00';
  if (isNumericValueType(type)) return 'Example: 12.5';
  if (isTrueOnlyValueType(type)) return 'Example: true';
  if (isBooleanValueType(type)) return 'Example: true / false';
  return 'Please enter free text.';
}

function describeFieldConstraint(column, language = 'en') {
  const parts = [];
  parts.push(column.required ? t(language, 'requiredLabel') : t(language, 'optionalLabel'));

  const valueType = String(column.valueType || 'TEXT').toUpperCase();
  if (isDateValueType(valueType)) {
    parts.push(t(language, 'dateFormatConstraint'));
  } else if (isNumericValueType(valueType)) {
    parts.push(t(language, 'numericValueConstraint'));
  } else if (isTrueOnlyValueType(valueType)) {
    parts.push('Allowed: true only');
  } else if (isBooleanValueType(valueType)) {
    parts.push(t(language, 'allowedTrueFalseConstraint'));
  } else {
    parts.push(`${t(language, 'typePrefix')}: ${valueType}`);
  }

  if (Array.isArray(column.options) && column.options.length > 0) {
    parts.push(`${t(language, 'optionSetPrefix')} (${column.options.length})`);
  }

  return parts.join(' | ');
}

function styleTypedEntryCell(cell, { required, valueType, hasOptions, isExample }) {
  const type = String(valueType || 'TEXT').toUpperCase();
  styleDataEntryCell(cell, required);

  if (isTextLikeValueType(type) && !hasOptions) {
    cell.alignment = { vertical: 'top', wrapText: true };
  } else if (type === 'DATE') {
    cell.numFmt = 'yyyy-mm-dd';
  }

  if (isExample) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: TEMPLATE_SECONDARY_ARGB },
    };
    return;
  }

  if (hasOptions || isBooleanValueType(valueType)) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: TEMPLATE_CELL_ARGB },
    };
    return;
  }

  if (isDateValueType(valueType)) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: TEMPLATE_CELL_ARGB },
    };
    return;
  }

  if (isNumericValueType(valueType)) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: TEMPLATE_CELL_ARGB },
    };
  }
}

function addDataEntryDashboard(ws, { statusCol, missingCol, dataStartRow, dataEndRow, dashboardCol, theme = null }) {
  const statusLetter = columnNumberToName(statusCol);
  const missingLetter = columnNumberToName(missingCol);
  const dashLetter = columnNumberToName(dashboardCol);
  const dashLetterNext = columnNumberToName(dashboardCol + 1);

  ws.getCell(`${dashLetter}1`).value = 'Data Entry Dashboard';
  ws.mergeCells(`${dashLetter}1:${dashLetterNext}1`);
  applyTemplateHeaderStyle(ws.getCell(`${dashLetter}1`), theme?.info || 'FFBFDBFE');

  ws.getCell(`${dashLetter}2`).value = 'Rows started';
  ws.getCell(`${dashLetterNext}2`).value = { formula: `COUNTIF(${statusLetter}${dataStartRow}:${statusLetter}${dataEndRow},"<>")`, result: 0 };

  ws.getCell(`${dashLetter}3`).value = 'Rows ready';
  ws.getCell(`${dashLetterNext}3`).value = { formula: `COUNTIF(${statusLetter}${dataStartRow}:${statusLetter}${dataEndRow},"Ready")`, result: 0 };

  ws.getCell(`${dashLetter}4`).value = 'Rows with issues';
  ws.getCell(`${dashLetterNext}4`).value = { formula: `COUNTIF(${statusLetter}${dataStartRow}:${statusLetter}${dataEndRow},"Missing required fields")`, result: 0 };

  ws.getCell(`${dashLetter}5`).value = 'Missing fields count';
  ws.getCell(`${dashLetterNext}5`).value = { formula: `COUNTIF(${missingLetter}${dataStartRow}:${missingLetter}${dataEndRow},"<>")`, result: 0 };

  ws.getCell(`${dashLetter}7`).value = 'Next action';
  ws.getCell(`${dashLetterNext}7`).value = {
    formula: `IF(${dashLetterNext}4>0,"Fix red rows in Row Status before import","Sheet looks ready for import")`,
    result: '',
  };

  for (let r = 2; r <= 7; r++) {
    ws.getCell(`${dashLetter}${r}`).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: TEMPLATE_CELL_ARGB },
    };
    ws.getCell(`${dashLetterNext}${r}`).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: TEMPLATE_CELL_ARGB },
    };
    ws.getCell(`${dashLetter}${r}`).border = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    };
    ws.getCell(`${dashLetterNext}${r}`).border = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    };
  }

  ws.getColumn(dashboardCol).width = 24;
  ws.getColumn(dashboardCol + 1).width = 32;
}

async function protectReadOnlySheet(ws) {
  await ws.protect('template-lock', {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: false,
    formatColumns: false,
    formatRows: false,
    insertColumns: false,
    insertRows: false,
    insertHyperlinks: false,
    deleteColumns: false,
    deleteRows: false,
    sort: false,
    autoFilter: false,
    pivotTables: false,
  });
}

function buildHorizontalValidationFormula(rowNumber, firstDataCol, lastDataCol, requiredCols = []) {
  const dataRange = `${columnNumberToName(firstDataCol)}${rowNumber}:${columnNumberToName(lastDataCol)}${rowNumber}`;
  if (!requiredCols.length) {
    return `IF(COUNTA(${dataRange})=0,"",IF(COUNTA(${dataRange})>0,"Ready",""))`;
  }

  const requiredRefs = requiredCols.map((col) => `${columnNumberToName(col)}${rowNumber}`).join(',');
  return `IF(COUNTA(${dataRange})=0,"",IF(COUNTA(${requiredRefs})=${requiredCols.length},"Ready","Missing required fields"))`;
}

function addValidationConditionalFormatting(ws, validationCol, dataStartRow, dataEndRow) {
  const colLetter = columnNumberToName(validationCol);
  const ref = `${colLetter}${dataStartRow}:${colLetter}${dataEndRow}`;

  ws.addConditionalFormatting({
    ref,
    rules: [
      {
        type: 'expression',
        formulae: [`${colLetter}${dataStartRow}="Ready"`],
        style: {
          fill: {
            type: 'pattern',
            pattern: 'solid',
            bgColor: { argb: 'FFECFDF5' },
            fgColor: { argb: 'FFD1FAE5' },
          },
          font: { color: { argb: 'FF065F46' }, bold: true },
        },
      },
      {
        type: 'expression',
        formulae: [`${colLetter}${dataStartRow}="Missing required fields"`],
        style: {
          fill: {
            type: 'pattern',
            pattern: 'solid',
            bgColor: { argb: 'FFFEF2F2' },
            fgColor: { argb: 'FFFEE2E2' },
          },
          font: { color: { argb: 'FF991B1B' }, bold: true },
        },
      },
    ],
  });
}

function shouldHideTemplateKey(key, programMeta) {
  if (!programMeta?.id) return false;
  return key === 'program' || key === 'programStage';
}

function buildVerticalValidationFormula(rowNumber) {
  return `IF(COUNTA(A${rowNumber}:E${rowNumber})=0,"",IF(RIGHT(C${rowNumber},2)=" *",IF(E${rowNumber}="","Missing required fields","Ready"),IF(E${rowNumber}="","","Ready")))`;
}

function buildVerticalMissingRequiredFormula(rowNumber) {
  return `IF(COUNTA(A${rowNumber}:E${rowNumber})=0,"",IF(RIGHT(C${rowNumber},2)=" *",IF(E${rowNumber}="",B${rowNumber},""),""))`;
}

function buildHorizontalMissingRequiredFormula(rowNumber, columns, statusCol) {
  const missingChecks = [];
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (!col.required) continue;
    const letter = columnNumberToName(i + 1);
    const label = String(col.label || col.key || `Field ${i + 1}`).replace(/"/g, "''");
    missingChecks.push(`IF(${letter}${rowNumber}="","${label}, ","")`);
  }

  if (missingChecks.length === 0) {
    return '""';
  }

  const statusRef = `${columnNumberToName(statusCol)}${rowNumber}`;
  return `IF(${statusRef}<>"Missing required fields","",TEXTJOIN("",TRUE,${missingChecks.join(',')}))`;
}

function buildHorizontalRowQualityFormula(rowNumber, statusCol, missingCol) {
  const statusRef = `${columnNumberToName(statusCol)}${rowNumber}`;
  const missingRef = `${columnNumberToName(missingCol)}${rowNumber}`;
  return `IF(${statusRef}="", "", IF(${statusRef}="Ready", 100, MAX(0, 100 - LEN(${missingRef})*2)))`;
}

function buildHorizontalFirstIssueFormula(rowNumber, statusCol, missingCol) {
  const statusRef = `${columnNumberToName(statusCol)}${rowNumber}`;
  const missingRef = `${columnNumberToName(missingCol)}${rowNumber}`;
  return `IF(${statusRef}="", "", IF(${statusRef}="Ready", "No blocking issue", IF(${missingRef}="", "Check required fields", LEFT(${missingRef}, 120))))`;
}

function buildVerticalRowQualityFormula(rowNumber) {
  return `IF(F${rowNumber}="", "", IF(F${rowNumber}="Ready", 100, IF(G${rowNumber}="", 80, 40)))`;
}

function buildVerticalFirstIssueFormula(rowNumber) {
  return `IF(F${rowNumber}="", "", IF(F${rowNumber}="Ready", "No blocking issue", IF(G${rowNumber}="", "Check required fields", G${rowNumber})))`;
}

function formatSectionHeading(sectionName) {
  const raw = String(sectionName || 'Section').trim();
  if (!raw) return 'Section';
  const withoutPrefix = raw
    .replace(/^data\s*entry(?:\s*[-_:]\s*|\s+)/i, '')
    .replace(/^[-_:\s]+/, '')
    .trim();

  if (!withoutPrefix) return 'Section';
  if (/^d$/i.test(withoutPrefix)) return 'Data Elements';
  return withoutPrefix;
}

function formatValueTypeLabel(valueType, language = 'en') {
  const type = String(valueType || 'TEXT').trim().toUpperCase();
  const labels = {
    TEXT: t(language, 'textType'),
    LONG_TEXT: t(language, 'longTextType'),
    LETTER: t(language, 'letterType'),
    EMAIL: t(language, 'emailType'),
    PHONE_NUMBER: t(language, 'phoneNumberType'),
    DATE: t(language, 'dateType'),
    DATETIME: t(language, 'dateTimeType'),
    BOOLEAN: t(language, 'booleanType'),
    TRUE_ONLY: t(language, 'trueOnlyType'),
    INTEGER: t(language, 'integerType'),
    INTEGER_POSITIVE: t(language, 'positiveIntegerType'),
    INTEGER_NEGATIVE: t(language, 'negativeIntegerType'),
    INTEGER_ZERO_OR_POSITIVE: t(language, 'zeroOrPositiveIntegerType'),
    NUMBER: t(language, 'numberType'),
    PERCENTAGE: t(language, 'percentageType'),
    UNIT_INTERVAL: t(language, 'unitIntervalType'),
    AGE: t(language, 'ageType'),
  };

  if (labels[type]) return labels[type];
  return type
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatEntryTypeLabel(valueType, hasOptions, language = 'en') {
  if (hasOptions) return t(language, 'dropdownListTypeHint');
  return formatValueTypeLabel(valueType, language);
}

function wrapHeaderText(value, maxLineLength = 24) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';

  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLineLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.join('\n');
}

function reorderColumnsForEntry(columns) {
  const groups = new Map();
  const order = [];

  for (const column of columns) {
    const section = formatSectionHeading(column.sectionName || 'Section');
    if (!groups.has(section)) {
      groups.set(section, []);
      order.push(section);
    }
    groups.get(section).push(column);
  }

  const ordered = [];
  for (const section of order) {
    const list = groups.get(section) || [];
    const required = list.filter((col) => col.required);
    const optional = list.filter((col) => !col.required);
    ordered.push(...required, ...optional);
  }

  return ordered;
}

function defaultStatusOptionsByType(dataType) {
  if (dataType === 'enrollments') return ['ACTIVE', 'COMPLETED', 'CANCELLED'];
  if (dataType === 'events') return ['ACTIVE', 'COMPLETED', 'VISITED', 'SCHEDULE', 'OVERDUE', 'SKIPPED'];
  return ['ACTIVE', 'COMPLETED', 'CANCELLED'];
}

const UID_MAPPING_SHEET_NAME = 'UID Mapping';
const UID_IDENTITY_SHEET_NAME = 'Import Identity Mapping';

function parseFieldUidFromKey(key = '') {
  const raw = String(key || '').trim();
  const deMatch = raw.match(/^de_([A-Za-z0-9]{11})(?:__coc_([A-Za-z0-9]{11}))?/);
  if (deMatch) {
    return {
      dataElementUid: deMatch[1],
      categoryOptionComboUid: deMatch[2] || '',
      trackedEntityAttributeUid: '',
    };
  }

  const attrMatch = raw.match(/^attr_([A-Za-z0-9]{11})/);
  if (attrMatch) {
    return {
      dataElementUid: '',
      categoryOptionComboUid: '',
      trackedEntityAttributeUid: attrMatch[1],
    };
  }

  return {
    dataElementUid: '',
    categoryOptionComboUid: '',
    trackedEntityAttributeUid: '',
  };
}

function _buildUidMappingSheet(wb, {
  columns = [],
  rows = [],
  dataType = 'events',
  programMeta = null,
}) {
  const ws = wb.addWorksheet(UID_MAPPING_SHEET_NAME);
  ws.state = 'veryHidden';
  ws.addRow([
    'visibleLabel',
    'fieldKey',
    'dataElementUid',
    'trackedEntityAttributeUid',
    'programUid',
    'programStageUid',
    'categoryOptionComboUid',
    'attributeOptionComboUid',
    'valueType',
    'required',
  ]);

  const programUid = String(programMeta?.id || '').trim();
  const rowProgramStage = String(rows?.[0]?.programStage || '').trim();

  for (const column of columns) {
    const field = parseFieldUidFromKey(column?.key);
    ws.addRow([
      String(column?.label || column?.key || '').trim(),
      String(column?.key || '').trim(),
      field.dataElementUid,
      field.trackedEntityAttributeUid,
      programUid,
      rowProgramStage,
      field.categoryOptionComboUid,
      String(rows?.[0]?.attributeOptionCombo || '').trim(),
      String(column?.valueType || 'TEXT').trim(),
      column?.required ? 'true' : 'false',
    ]);
  }

  // Keep row-level identity mapping below the field mapping block for diagnostics.
  ws.addRow([]);
  ws.addRow(['identityMappingSheet', UID_IDENTITY_SHEET_NAME]);
  ws.addRow(['templateDataType', String(dataType || '').trim()]);

  return ws;
}

/**
 * Build a hidden UID Mapping sheet so re-imports reuse existing DHIS2 UIDs.
 * Stored per-row: natural key + resolved UID fields + row hash for change detection.
 */
function _buildImportIdentityMappingSheet(wb, rows, dataType) {
  if (dataType === 'aggregate' || !Array.isArray(rows) || rows.length === 0) return;

  const ws = wb.addWorksheet(UID_IDENTITY_SHEET_NAME);
  ws.state = 'veryHidden';
  ws.addRow([
    'recordType', 'stableImportKey', 'dhis2Uid',
    'trackedEntityUid', 'enrollmentUid', 'programUid',
    'programStageUid', 'orgUnitUid', 'occurredAt', 'sourceRowHash',
  ]);

  const uidPattern = /^[A-Za-z][A-Za-z0-9]{10}$/;

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;

    let recordType;
    let stableKey;
    let dhis2Uid = '';
    let trackedEntityUid = '';
    let enrollmentUid = '';

    if (dataType === 'events') {
      recordType = 'event';
      stableKey = buildEventStableKey({
        program: row.program, programStage: row.programStage,
        orgUnit: row.orgUnit, occurredAt: row.occurredAt || row.eventDate,
        trackedEntity: row.trackedEntity,
      });
      const rawId = String(row.event || '').trim();
      if (rawId.toUpperCase() !== 'AUTO' && uidPattern.test(rawId)) dhis2Uid = rawId;
      trackedEntityUid = String(row.trackedEntity || '').trim();
      enrollmentUid = String(row.enrollment || '').trim();
    } else if (dataType === 'enrollments') {
      recordType = 'enrollment';
      stableKey = buildEnrollmentStableKey({
        program: row.program, orgUnit: row.orgUnit, trackedEntity: row.trackedEntity,
        enrolledAt: row.enrolledAt || row.enrollmentDate,
        occurredAt: row.occurredAt || row.incidentDate,
      });
      const rawId = String(row.enrollment || '').trim();
      if (rawId.toUpperCase() !== 'AUTO' && uidPattern.test(rawId)) dhis2Uid = rawId;
      trackedEntityUid = String(row.trackedEntity || '').trim();
      enrollmentUid = dhis2Uid;
    } else if (dataType === 'trackedEntities') {
      recordType = 'trackedEntity';
      stableKey = buildTrackedEntityStableKey({
        trackedEntityType: row.trackedEntityType, orgUnit: row.orgUnit,
      });
      const rawId = String(row.trackedEntity || '').trim();
      if (rawId.toUpperCase() !== 'AUTO' && uidPattern.test(rawId)) dhis2Uid = rawId;
      trackedEntityUid = dhis2Uid;
    } else {
      continue;
    }

    if (!stableKey) continue;
    ws.addRow([
      recordType, stableKey, dhis2Uid,
      trackedEntityUid, enrollmentUid,
      String(row.program || '').trim(),
      String(row.programStage || '').trim(),
      String(row.orgUnit || '').trim(),
      String(row.occurredAt || row.eventDate || row.enrolledAt || '').trim(),
      buildRowHash(row),
    ]);
  }
}

async function buildTemplateWorkbook({
  rows = [],
  sections = [],
  dataType = 'events',
  programMeta = null,
  dataSetMeta = null,
  templateSettings = {},
}) {
  const language = normalizeTemplateLanguage(templateSettings.language || 'en');
  const sheetNames = {
    start: t(language, 'sheetStartHere'),
    data: t(language, 'sheetDataEntry'),
    validation: t(language, 'sheetValidation'),
    meta: t(language, 'sheetMetadataSnapshot'),
  };

  const wb = new ExcelJS.Workbook();
  const theme = getTemplateTheme(dataType);
  const wsStart = wb.addWorksheet(sheetNames.start);
  const wsData = wb.addWorksheet(sheetNames.data);
  const wsValidation = wb.addWorksheet(sheetNames.validation);
  const wsMeta = wb.addWorksheet(sheetNames.meta);

  const flatQuestions = [];
  for (const section of sections || []) {
    for (const question of section.questions || []) {
      flatQuestions.push({
        key: question.key,
        label: question.label || question.key,
        description: question.description || question.helpText || '',
        valueType: question.valueType || 'TEXT',
        required: Boolean(question.required),
        sectionName: formatSectionHeading(section.name || t(language, 'sectionHeader')),
        options: Array.isArray(question.options) ? question.options : [],
      });
    }
  }

  const fallbackColumns = rows[0]
    ? Object.keys(rows[0]).map((key) => ({
      key,
      label: key,
      description: '',
      valueType: 'TEXT',
      required: false,
      sectionName: t(language, 'sectionHeader'),
    }))
    : [];
  const scopedPeriods = [...new Set((rows || [])
    .map((row) => String(row?.period || '').trim())
    .filter(Boolean))];

  const firstRow = rows[0] || {};
  const layout = templateSettings.layout === 'vertical' ? 'vertical' : 'horizontal';
  const orgUnitScope = String(templateSettings.orgUnitScope || 'all').toLowerCase();
  const scopedOrgUnitIds = Array.isArray(templateSettings.orgUnitIds) ? templateSettings.orgUnitIds.filter(Boolean) : [];
  const scopedOrgUnitNames = (Array.isArray(templateSettings.orgUnitEntries) && templateSettings.orgUnitEntries.length > 0
    ? templateSettings.orgUnitEntries.map((entry) => String(entry?.name || '').trim()).filter(Boolean)
    : (templateSettings.orgUnitNames || []).map((name) => String(name || '').trim()).filter(Boolean));
  const hasSpecificOrgUnits = scopedOrgUnitNames.length > 0 && (orgUnitScope !== 'all' || scopedOrgUnitIds.length > 0);
  const specificOrgUnit = hasSpecificOrgUnits ? scopedOrgUnitNames[0] : null;
  const singleOrgUnit = specificOrgUnit;
  const singlePeriod = scopedPeriods.length === 1
    ? scopedPeriods[0]
    : (scopedPeriods.length === 0 && templateSettings.period ? String(templateSettings.period).trim() : null);

  const columns = reorderColumnsForEntry((flatQuestions.length > 0 ? flatQuestions : fallbackColumns).map((column) => {
    if (column.key === 'orgUnit') {
      if (singleOrgUnit) {
        return { ...column, options: [], contextValue: singleOrgUnit, isContext: true };
      }
      if (orgUnitScope === 'all' && scopedOrgUnitNames.length > 0) {
        return { ...column, options: scopedOrgUnitNames };
      }
    }

    if (column.key === 'period') {
      if (singlePeriod) {
        return { ...column, options: [], contextValue: singlePeriod, isContext: true };
      }
      if (scopedPeriods.length > 0) {
        return { ...column, options: scopedPeriods };
      }
    }

    if (column.key === 'status' && (!Array.isArray(column.options) || column.options.length === 0)) {
      return {
        ...column,
        options: defaultStatusOptionsByType(dataType),
      };
    }

    return column;
  }));
  const optionRanges = buildOptionListRanges(wb, columns, language);

  const hasPeriodAndOrgUnitColumns = columns.some((col) => col.key === 'period') && columns.some((col) => col.key === 'orgUnit');
  const defaultOpenRows = 25;
  const baseRows = Array.isArray(rows) ? rows.filter((row) => row && typeof row === 'object') : [];
  let scopedSeedRows = [];
  if (hasSpecificOrgUnits) {
    const source = baseRows[0] || {};
    scopedSeedRows = [{
      ...source,
      orgUnit: singleOrgUnit || String(source.orgUnit || '').trim(),
    }].map((seeded) => {
      if (singlePeriod && !String(seeded.period || '').trim()) seeded.period = singlePeriod;
      return seeded;
    });
  } else if (baseRows.length > 0) {
    scopedSeedRows = baseRows.map((source) => {
      const seeded = { ...source };
      if (singlePeriod && !String(seeded.period || '').trim()) seeded.period = singlePeriod;
      if (orgUnitScope === 'all') seeded.orgUnit = '';
      return seeded;
    });
  } else {
    const rowCount = orgUnitScope === 'all' ? defaultOpenRows : 1;
    scopedSeedRows = Array.from({ length: rowCount }, () => ({
      ...(singlePeriod ? { period: singlePeriod } : {}),
      ...(orgUnitScope === 'all' ? { orgUnit: '' } : {}),
    }));
  }

  if (layout === 'horizontal') {
    if (hasSpecificOrgUnits) {
      scopedSeedRows = scopedSeedRows.slice(0, 1);
    } else if (scopedSeedRows.length < defaultOpenRows) {
      const templateRow = scopedSeedRows[0] || {};
      while (scopedSeedRows.length < defaultOpenRows) {
        scopedSeedRows.push({
          ...(singlePeriod ? { period: singlePeriod } : {}),
          ...(orgUnitScope === 'all' ? { orgUnit: '' } : {}),
          ...Object.fromEntries(Object.keys(templateRow).map((key) => [key, key === 'period' && singlePeriod ? singlePeriod : ''])),
        });
      }
    }
  }

  const horizontalSectionRow = 1;
  const horizontalQuestionRow = 2;
  const horizontalValueTypeRow = 3;
  const horizontalDataStartRow = 4;
  const verticalHeaderRow = 1;
  const verticalDataStartRow = 2;
  const dataStartRow = layout === 'vertical' ? verticalDataStartRow : horizontalDataStartRow;
  const dataEndRow = dataStartRow + Math.max(1, scopedSeedRows.length) - 1;
  let statusCol = 0;
  let missingRequiredCol = 0;
  let validationStartRow = dataStartRow;
  let validationEndRow = dataEndRow;

  wsStart.columns = [
    { header: t(language, 'step'), key: 'step', width: 20 },
    { header: t(language, 'instructions'), key: 'instruction', width: 120 },
  ];
  applySheetTitleStyle(wsStart.getCell('A1'), theme.cover);
  applySheetTitleStyle(wsStart.getCell('B1'), theme.cover);
  wsStart.getRow(1).height = 28;

  if (dataType === 'aggregate') {
    const datasetLabel = String(dataSetMeta?.displayName || firstRow.dataSet || '').trim();
    const periodLabel = String(firstRow.period || templateSettings.period || '').trim();

    wsStart.addRow({ step: 'AGGREGATE DATASET SUBMISSION', instruction: '' });
    wsStart.addRow({ step: 'Dataset:', instruction: datasetLabel });
    wsStart.addRow({ step: 'Period:', instruction: periodLabel });
    const submissionDecisionRow = wsStart.addRow({ step: 'Submission Decision:', instruction: 'Draft' }).number;
    const submissionCommentRow = wsStart.addRow({ step: 'Submission Comment:', instruction: '' }).number;
    wsStart.addRow({ step: '', instruction: '' });

    const submissionDecisionCell = wsStart.getCell(submissionDecisionRow, 2);
    submissionDecisionCell.dataValidation = {
      type: 'list',
      formulae: ['"Draft,Submit and Mark Complete"'],
      allowBlank: false,
      showInputMessage: false,
      promptTitle: t(language, 'dropdownListType'),
      prompt: 'Choose Draft or Submit and Mark Complete.',
      showErrorMessage: true,
      errorTitle: t(language, 'invalidValueTitle'),
      error: 'Use Draft or Submit and Mark Complete.',
    };
    submissionDecisionCell.protection = { locked: false };

    const submissionCommentCell = wsStart.getCell(submissionCommentRow, 2);
    submissionCommentCell.protection = { locked: false };
  }

  wsStart.addRow({ step: '1', instruction: t(language, 'fillInstruction') });
  wsStart.addRow({ step: '2', instruction: t(language, 'doNotEditInstruction') });
  wsStart.addRow({ step: '3', instruction: t(language, 'dateInstruction') });
  wsStart.addRow({ step: '4', instruction: t(language, 'reviewInstruction') });
  wsStart.addRow({ step: '5', instruction: t(language, 'uploadInstruction') });
  wsStart.addRow({ step: t(language, 'legend'), instruction: t(language, 'shadedCellsLegend') });
  wsStart.addRow({ step: t(language, 'templateType'), instruction: dataType });
  wsStart.addRow({ step: t(language, 'program'), instruction: programMeta?.displayName || t(language, 'notSelected') });
  wsStart.addRow({ step: t(language, 'orgUnitScope'), instruction: templateSettings.orgUnitScope || 'all' });
  wsStart.addRow({ step: t(language, 'selectedOrgUnits'), instruction: (templateSettings.orgUnitNames || templateSettings.orgUnitIds || []).join(', ') || t(language, 'allAccessibleUnits') });
  wsStart.addRow({ step: t(language, 'language'), instruction: language });
  wsStart.addRow({ step: t(language, 'layout'), instruction: layout });

  for (let rowNumber = 2; rowNumber <= wsStart.rowCount; rowNumber++) {
    applySheetCellStyle(wsStart.getCell(rowNumber, 1), {
      fillColor: rowNumber % 2 === 0 ? theme.surface : theme.surfaceAlt,
      fontColor: 'FF1E293B',
      bold: rowNumber <= 2,
    });
    applySheetCellStyle(wsStart.getCell(rowNumber, 2), {
      fillColor: theme.surface,
      fontColor: 'FF0F172A',
    });
  }

  if (columns.length > 0) {
    if (layout === 'vertical') {
      wsData.columns = [
        { header: t(language, 'sectionHeader'), key: 'section', width: 28 },
        { header: t(language, 'questionHeader'), key: 'question', width: 42 },
        { header: t(language, 'keyHeader'), key: 'key', width: 36 },
        { header: t(language, 'valueTypeHeader'), key: 'valueType', width: 18 },
        { header: t(language, 'valueHeader'), key: 'value', width: 28 },
      ];

      ['A1', 'B1', 'C1', 'D1', 'E1'].forEach((address) => {
        applySheetTitleStyle(wsData.getCell(address), theme.primary);
      });
      wsData.getCell('A1').value = t(language, 'sectionHeader');
      wsData.getCell('B1').value = t(language, 'questionHeader');
      wsData.getCell('C1').value = t(language, 'keyHeader');
      wsData.getCell('D1').value = t(language, 'valueTypeHeader');
      wsData.getCell('E1').value = t(language, 'valueHeader');
      wsData.getRow(1).height = 34;

      const includeOrgUnitFieldInVertical = orgUnitScope === 'all';
      const verticalColumns = includeOrgUnitFieldInVertical ? columns : columns.filter((column) => column.key !== 'orgUnit');
      const groupedRows = [];

      const sourceRow = scopedSeedRows[0] || firstRow;
      if (!includeOrgUnitFieldInVertical && singleOrgUnit) {
        groupedRows.push({ section: 'Context', question: 'Organisation Unit', key: 'orgUnit', valueType: 'TEXT', value: singleOrgUnit, isContext: true });
      }
      verticalColumns.forEach((column) => {
        groupedRows.push({
          section: column.sectionName || 'Template Fields',
          question: column.label,
          key: `${column.key}${column.required ? ' *' : ''}`,
          valueType: column.valueType || 'TEXT',
          value: sourceRow[column.key] ?? '',
          forceContextLock: Boolean(column.key === 'period' && singlePeriod),
        });
      });

      for (const rowData of groupedRows) {
        wsData.addRow(rowData);
      }

      for (let rowNumber = dataStartRow; rowNumber <= wsData.rowCount; rowNumber++) {
        wsData.getRow(rowNumber).height = 26;
        const valueCell = wsData.getCell(rowNumber, 5);
        const required = String(wsData.getCell(rowNumber, 3).value || '').endsWith(' *');
        const valueType = wsData.getCell(rowNumber, 4).value;
        const keyRaw = String(wsData.getCell(rowNumber, 3).value || '');
        const key = keyRaw.endsWith(' *') ? keyRaw.slice(0, -2) : keyRaw;
        const isContextRow = key === 'orgUnit' && Boolean(singleOrgUnit)
          || (key === 'period' && Boolean(singlePeriod));

        if (isContextRow) {
          valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEMPLATE_CONTEXT_ARGB } };
          valueCell.font = { color: { argb: 'FF1E3A5F' }, italic: true, size: 10 };
          valueCell.border = {
            top: { style: 'thin', color: { argb: 'FFB0CCED' } },
            left: { style: 'thin', color: { argb: 'FFB0CCED' } },
            bottom: { style: 'thin', color: { argb: 'FFB0CCED' } },
            right: { style: 'thin', color: { argb: 'FFB0CCED' } },
          };
          valueCell.protection = { locked: true };
        } else {
          styleTypedEntryCell(valueCell, {
            required,
            valueType,
            hasOptions: Boolean(optionRanges[key]),
            isExample: false,
          });
        }

        if (!isContextRow) {
          applyDataValidationForColumn(wsData, 5, valueType, rowNumber, rowNumber, optionRanges[key] || null, language);
        }

        if (shouldHideTemplateKey(key, programMeta)) {
          wsData.getRow(rowNumber).hidden = true;
        }
      }

      let eventRowNumber = null;
      let orgUnitRowNumber = null;
      for (let rowNumber = 2; rowNumber <= wsData.rowCount; rowNumber++) {
        const keyRaw = String(wsData.getCell(rowNumber, 3).value || '');
        const key = keyRaw.endsWith(' *') ? keyRaw.slice(0, -2) : keyRaw;
        if (key === 'event') eventRowNumber = rowNumber;
        if (key === 'orgUnit') orgUnitRowNumber = rowNumber;
      }

      if (eventRowNumber && orgUnitRowNumber) {
        const eventCell = wsData.getCell(eventRowNumber, 5);
        const orgUnitRef = `E${orgUnitRowNumber}`;
        eventCell.value = {
          formula: `IF(${orgUnitRef}="","","AUTO")`,
          result: '',
        };
        eventCell.note = t(language, 'eventAutoNote');
      }

      wsData.getColumn(3).hidden = true;
      validationStartRow = dataStartRow;
      validationEndRow = wsData.rowCount;

      applyRowBandingToUsedRows(wsData, dataStartRow, wsData.rowCount, 5);

      wsData.views = [{ state: 'frozen', ySplit: 1, xSplit: 1 }];
    } else {
      const dataStartCol = 1;

      let col = dataStartCol;
      while (col <= columns.length) {
        const sectionName = formatSectionHeading(columns[col - dataStartCol].sectionName || 'Section');
        let end = col;
        while (end <= columns.length && formatSectionHeading(columns[end - dataStartCol].sectionName || 'Section') === sectionName) {
          end += 1;
        }
        wsData.mergeCells(horizontalSectionRow, col, horizontalSectionRow, end - 1);
        const sectionCell = wsData.getCell(horizontalSectionRow, col);
        sectionCell.value = sectionName;
        applySheetTitleStyle(sectionCell, theme.primary);
        col = end;
      }

      columns.forEach((column, index) => {
        const c = index + dataStartCol;

        const qCell = wsData.getCell(horizontalQuestionRow, c);
        qCell.value = wrapHeaderText(column.label, 26);
        applyTemplateHeaderStyle(qCell, column.required ? theme.secondary : theme.primary);
        qCell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
        qCell.font = {
          ...(qCell.font || {}),
          bold: true,
          size: 11,
        };

        const valueTypeCell = wsData.getCell(horizontalValueTypeRow, c);
        if (column.isContext) {
          valueTypeCell.value = `Pre-filled \u2022 locked`;
          applySheetCellStyle(valueTypeCell, {
            fillColor: TEMPLATE_CONTEXT_ARGB,
            fontColor: 'FF1E3A5F',
            italic: true,
          });
        } else {
          valueTypeCell.value = wrapHeaderText(
            formatEntryTypeLabel(column.valueType, Boolean(optionRanges[column.key]), language),
            26,
          );
          applySheetCellStyle(valueTypeCell, {
            fillColor: theme.surface,
            fontColor: 'FF334155',
            italic: true,
          });
        }
        valueTypeCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        valueTypeCell.font = {
          ...(valueTypeCell.font || {}),
          size: 10,
          italic: true,
        };

        const configuredDescription = String(column.description || '').trim();
        if (configuredDescription) {
          qCell.note = configuredDescription;
        } else {
          qCell.note = '';
        }

        wsData.getColumn(c).width = Math.max(18, Math.min(52, Math.ceil((column.label || '').length * 0.95)));
        if (shouldHideTemplateKey(column.key, programMeta)) {
          wsData.getColumn(c).hidden = true;
        }
      });
      wsData.getRow(horizontalSectionRow).height = 32;
      wsData.getRow(horizontalQuestionRow).height = 68;
      wsData.getRow(horizontalValueTypeRow).height = 24;

      for (let rowNumber = dataStartRow; rowNumber <= dataEndRow; rowNumber++) {
        const seed = scopedSeedRows[rowNumber - dataStartRow] || {};
        columns.forEach((column, index) => {
          const c = index + dataStartCol;
          const cell = wsData.getCell(rowNumber, c);
          const rowValue = seed[column.key];
          const shouldLockFromScope = false;
          if (column.isContext && column.contextValue) {
            cell.value = column.contextValue;
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEMPLATE_CONTEXT_ARGB } };
            cell.font = { color: { argb: 'FF1E3A5F' }, italic: true, size: 10 };
            cell.border = {
              top: { style: 'thin', color: { argb: 'FFB0CCED' } },
              left: { style: 'thin', color: { argb: 'FFB0CCED' } },
              bottom: { style: 'thin', color: { argb: 'FFB0CCED' } },
              right: { style: 'thin', color: { argb: 'FFB0CCED' } },
            };
            cell.protection = { locked: true };
          } else if (shouldLockFromScope && column.key === 'orgUnit') {
            cell.value = rowValue || '';
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEMPLATE_CONTEXT_ARGB } };
            cell.font = { color: { argb: 'FF1E3A5F' }, italic: true, size: 10 };
            cell.border = {
              top: { style: 'thin', color: { argb: 'FFB0CCED' } },
              left: { style: 'thin', color: { argb: 'FFB0CCED' } },
              bottom: { style: 'thin', color: { argb: 'FFB0CCED' } },
              right: { style: 'thin', color: { argb: 'FFB0CCED' } },
            };
            cell.protection = { locked: true };
          } else {
            if (rowValue !== undefined && rowValue !== null && String(rowValue).trim() !== '' && !column.isContext) {
              cell.value = rowValue;
            }
            styleTypedEntryCell(cell, {
              required: column.required,
              valueType: column.valueType,
              hasOptions: Boolean(optionRanges[column.key]),
              isExample: false,
            });
          }
        });
      }

      const eventColIndex = columns.findIndex((col) => col.key === 'event');
      const orgUnitColIndex = columns.findIndex((col) => col.key === 'orgUnit');
      if (eventColIndex >= 0 && orgUnitColIndex >= 0) {
        const eventCol = eventColIndex + dataStartCol;
        const orgUnitCol = orgUnitColIndex + dataStartCol;
        const eventColLetter = columnNumberToName(eventCol);
        const orgUnitColLetter = columnNumberToName(orgUnitCol);

        for (let rowNumber = dataStartRow; rowNumber <= dataEndRow; rowNumber++) {
          const eventCell = wsData.getCell(rowNumber, eventCol);
          if (!eventCell.value || String(eventCell.value).trim() === '') {
            eventCell.value = {
              formula: `IF(${orgUnitColLetter}${rowNumber}="","","AUTO")`,
              result: '',
            };
          }
        }

        wsData.getCell(dataStartRow, eventCol).note = t(language, 'eventAutoNote');
        wsData.getCell(dataStartRow + 1, eventCol).note = t(language, 'eventAutoNote');
      }

      columns.forEach((column, index) => {
        if (column.isContext) return; // locked pre-filled cells need no data validation
        applyDataValidationForColumn(
          wsData,
          index + dataStartCol,
          column.valueType,
          dataStartRow,
          dataEndRow,
          optionRanges[column.key] || null,
          language,
        );
      });

      wsData.views = [{ state: 'frozen', ySplit: 3, xSplit: hasPeriodAndOrgUnitColumns ? 2 : 1 }];

      applyRowBandingToUsedRows(wsData, dataStartRow, dataEndRow, columns.length);

      validationStartRow = dataStartRow;
      validationEndRow = dataEndRow;
    }
  }

  await wsData.protect('template-lock', {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: false,
    formatColumns: false,
    formatRows: false,
    insertColumns: false,
    insertRows: false,
    insertHyperlinks: false,
    deleteColumns: false,
    deleteRows: false,
    sort: false,
    autoFilter: false,
    pivotTables: false,
  });

  wsValidation.columns = [
    { header: t(language, 'metricHeader'), key: 'metric', width: 40 },
    { header: t(language, 'valueHeader'), key: 'value', width: 30 },
    { header: t(language, 'notesHeader'), key: 'notes', width: 72 },
  ];
  applySheetTitleStyle(wsValidation.getCell('A1'), theme.secondary);
  applySheetTitleStyle(wsValidation.getCell('B1'), theme.secondary);
  applySheetTitleStyle(wsValidation.getCell('C1'), theme.secondary);

  if (statusCol && missingRequiredCol) {
    const statusLetter = columnNumberToName(statusCol);
    const missingLetter = columnNumberToName(missingRequiredCol);
    wsValidation.addRow({
      metric: t(language, 'rowsStartedMetric'),
      value: { formula: `COUNTIF('${sheetNames.data}'!${statusLetter}${validationStartRow}:${statusLetter}${validationEndRow},"<>")`, result: 0 },
      notes: t(language, 'rowsStartedNote'),
    });
    wsValidation.addRow({
      metric: t(language, 'rowsReadyMetric'),
      value: { formula: `COUNTIF('${sheetNames.data}'!${statusLetter}${validationStartRow}:${statusLetter}${validationEndRow},"Ready")`, result: 0 },
      notes: t(language, 'rowsReadyNote'),
    });
    wsValidation.addRow({
      metric: t(language, 'rowsMissingMetric'),
      value: { formula: `COUNTIF('${sheetNames.data}'!${statusLetter}${validationStartRow}:${statusLetter}${validationEndRow},"Missing required fields")`, result: 0 },
      notes: t(language, 'rowsMissingNote'),
    });
    wsValidation.addRow({
      metric: t(language, 'firstMissingMetric'),
      value: { formula: `IFERROR(INDEX('${sheetNames.data}'!${missingLetter}${validationStartRow}:${missingLetter}${validationEndRow},MATCH("*",'${sheetNames.data}'!${missingLetter}${validationStartRow}:${missingLetter}${validationEndRow},0)),"")`, result: '' },
      notes: t(language, 'firstMissingNote'),
    });
  } else {
    wsValidation.addRow({
      metric: t(language, 'templateChecksMetric'),
      value: t(language, 'disabledLabel'),
      notes: t(language, 'templateChecksNote'),
    });
  }

  wsValidation.addRow({ metric: '', value: '', notes: '' });
  wsValidation.addRow({ metric: t(language, 'fieldValidationMatrixTitle'), value: '', notes: t(language, 'fieldValidationMatrixNote') });
  const fieldMatrixSectionRow = wsValidation.rowCount;
  ['A', 'B', 'C'].forEach((col) => {
    const c = wsValidation.getCell(`${col}${fieldMatrixSectionRow}`);
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.surfaceAlt } };
    c.font = { bold: true, color: { argb: theme.primary }, size: 10 };
    c.border = {
      top: { style: 'medium', color: { argb: theme.primary } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    };
    c.alignment = { vertical: 'middle', wrapText: true };
  });
  wsValidation.addRow({ metric: t(language, 'fieldKeyLabel'), value: t(language, 'typeRequiredLabel'), notes: t(language, 'optionSetSampleNote') });

  const fieldMatrixHeaderRow = wsValidation.rowCount;
  applyTemplateHeaderStyle(wsValidation.getCell(`A${fieldMatrixHeaderRow}`), theme.muted);
  applyTemplateHeaderStyle(wsValidation.getCell(`B${fieldMatrixHeaderRow}`), theme.muted);
  applyTemplateHeaderStyle(wsValidation.getCell(`C${fieldMatrixHeaderRow}`), theme.muted);

  columns.forEach((column) => {
    const optionsPreview = Array.isArray(column.options) && column.options.length > 0
      ? column.options.slice(0, 8).join(', ')
      : '';
    wsValidation.addRow({
      metric: String(column.key || ''),
      value: describeFieldConstraint(column, language),
      notes: optionsPreview,
    });
  });

  const aggregateRules = Array.isArray(templateSettings.dataSetValidationRules)
    ? templateSettings.dataSetValidationRules
    : [];
  if (dataType === 'aggregate') {
    wsValidation.addRow({ metric: '', value: '', notes: '' });
    wsValidation.addRow({ metric: t(language, 'aggregateRulesTitle'), value: '', notes: t(language, 'aggregateRulesSummary') });
    const aggSectionRow = wsValidation.rowCount;
    ['A', 'B', 'C'].forEach((col) => {
      const c = wsValidation.getCell(`${col}${aggSectionRow}`);
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.surfaceAlt } };
      c.font = { bold: true, color: { argb: theme.secondary }, size: 10 };
      c.border = {
        top: { style: 'medium', color: { argb: theme.secondary } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
      c.alignment = { vertical: 'middle', wrapText: true };
    });
    wsValidation.addRow({ metric: t(language, 'ruleNameHeader'), value: t(language, 'descriptionHeader'), notes: t(language, 'instructionHeader') });

    const aggRuleHeaderRow = wsValidation.rowCount;
    applyTemplateHeaderStyle(wsValidation.getCell(`A${aggRuleHeaderRow}`), theme.secondary);
    applyTemplateHeaderStyle(wsValidation.getCell(`B${aggRuleHeaderRow}`), theme.secondary);
    applyTemplateHeaderStyle(wsValidation.getCell(`C${aggRuleHeaderRow}`), theme.secondary);

    if (aggregateRules.length === 0) {
      wsValidation.addRow({
        metric: t(language, 'noLinkedRulesMetric'),
        value: t(language, 'noLinkedRulesValue'),
        notes: t(language, 'noLinkedRulesNote'),
      });
    } else {
      aggregateRules.forEach((rule) => {
        wsValidation.addRow({
          metric: String(rule?.name || rule?.id || ''),
          value: String(rule?.description || ''),
          notes: String(rule?.instruction || ''),
        });
      });
    }
  }

  applyBandingToRange(wsValidation, 2, wsValidation.rowCount, 1, 3, {
    firstFill: theme.surface,
    secondFill: 'FFFFFFFF',
  });

  wsMeta.columns = [
    { header: t(language, 'keyMetaHeader'), key: 'key', width: 38 },
    { header: t(language, 'valueHeader'), key: 'value', width: 110 },
  ];
  applySheetTitleStyle(wsMeta.getCell('A1'), theme.primary);
  applySheetTitleStyle(wsMeta.getCell('B1'), theme.primary);

  const optionMap = {};
  for (const col of columns) {
    if (Array.isArray(col.options) && col.options.length) {
      optionMap[col.key] = col.options;
    }
  }

  wsMeta.addRow({ key: 'templateVersion', value: TEMPLATE_SCHEMA_VERSION });
  wsMeta.addRow({ key: 'generatorVersion', value: TEMPLATE_GENERATOR_VERSION });
  wsMeta.addRow({ key: 'generatedAt', value: new Date().toISOString() });
  wsMeta.addRow({ key: 'dataType', value: dataType });
  wsMeta.addRow({ key: 'layout', value: layout });
  wsMeta.addRow({ key: 'selectedLayout', value: layout });
  wsMeta.addRow({ key: 'selectedOrgUnitScope', value: templateSettings.orgUnitScope || 'all' });
  wsMeta.addRow({ key: 'dataHeaderRow', value: String(layout === 'vertical' ? verticalHeaderRow : horizontalQuestionRow) });
  wsMeta.addRow({ key: 'dataStartRow', value: String(dataStartRow) });
  wsMeta.addRow({ key: 'programId', value: programMeta?.id || '' });
  wsMeta.addRow({ key: 'programName', value: programMeta?.displayName || '' });
  wsMeta.addRow({ key: 'programStageId', value: rows?.[0]?.programStage || '' });
  wsMeta.addRow({ key: 'programStageName', value: templateSettings.programStageName || '' });
  wsMeta.addRow({ key: 'dataSetId', value: dataSetMeta?.id || templateSettings?.dataSetId || rows?.[0]?.dataSet || '' });
  wsMeta.addRow({ key: 'dataSetName', value: dataSetMeta?.displayName || '' });
  wsMeta.addRow({ key: 'scopeOrgUnit', value: singleOrgUnit || rows?.[0]?.orgUnit || '' });
  wsMeta.addRow({ key: 'scopePeriod', value: singlePeriod || rows?.[0]?.period || templateSettings.period || '' });
  wsMeta.addRow({ key: 'attributeOptionCombo', value: rows?.[0]?.attributeOptionCombo || templateSettings.attributeOptionCombo || '' });
  wsMeta.addRow({ key: 'aggregateDefaultAttributeOptionCombo', value: rows?.[0]?.attributeOptionCombo || templateSettings.attributeOptionCombo || '' });
  wsMeta.addRow({ key: 'fieldKeys', value: JSON.stringify(columns.map((c) => c.key)) });
  wsMeta.addRow({ key: 'requiredFieldKeys', value: JSON.stringify(columns.filter((c) => c.required).map((c) => c.key)) });
  wsMeta.addRow({ key: 'optionMap', value: JSON.stringify(optionMap) });
  wsMeta.addRow({ key: 'orgUnitScope', value: templateSettings.orgUnitScope || 'all' });
  wsMeta.addRow({ key: 'orgUnitIds', value: JSON.stringify(templateSettings.orgUnitIds || []) });
  wsMeta.addRow({ key: 'orgUnitNames', value: JSON.stringify(scopedOrgUnitNames || []) });
  if (dataType === 'aggregate') {
    const cocMetadata = buildAggregateCategoryOptionComboMetadata(columns);
    const hasDefaultMapping = Object.values(cocMetadata.byFieldKey).length > 0;
    wsMeta.addRow({ key: 'aggregateCategoryOptionComboByFieldKey', value: JSON.stringify(cocMetadata.byFieldKey) });
    wsMeta.addRow({ key: 'aggregateCategoryOptionComboByDataElement', value: JSON.stringify(cocMetadata.byDataElement) });
    wsMeta.addRow({ key: 'aggregateCategoryOptionComboSelectionPolicy', value: hasDefaultMapping ? 'default-or-first-available-hidden-in-data-entry' : 'none' });
  }

  applyBandingToRange(wsMeta, 2, wsMeta.rowCount, 1, 2, {
    firstFill: theme.surface,
    secondFill: 'FFFFFFFF',
  });

  if (dataType === 'aggregate') {
    wsMeta.addRow({ key: 'completionSheetEnabled', value: 'false' });
    wsMeta.addRow({ key: 'completionIntent.submissionComment', value: '' });
    wsMeta.addRow({ key: 'completionIntent.completed', value: 'false' });
    wsMeta.addRow({ key: 'completionIntent.submissionDecision', value: 'Draft' });
    wsMeta.addRow({ key: 'completionIntent.completionDate', value: '' });
  }

  wsValidation.state = 'hidden';
  wsMeta.state = 'veryHidden';

  const wsUidMap = _buildUidMappingSheet(wb, {
    columns,
    rows,
    dataType,
    programMeta,
  });
  _buildImportIdentityMappingSheet(wb, rows, dataType);

  await protectReadOnlySheet(wsStart);
  await protectReadOnlySheet(wsValidation);
  await protectReadOnlySheet(wsMeta);
  if (wsUidMap) await protectReadOnlySheet(wsUidMap);
  const wsIdentity = wb.getWorksheet(UID_IDENTITY_SHEET_NAME);
  if (wsIdentity) await protectReadOnlySheet(wsIdentity);

  return wb.xlsx.writeBuffer();
}

/**
 * Parse CSV buffer/string to JSON array.
 */
function csvToJson(csvData) {
  return parse(csvData, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

/**
 * Parse Excel buffer to JSON array using ExcelJS (reads first sheet).
 */
async function excelToJson(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = getWorksheetByAliases(wb, templateSheetAliases('sheetDataEntry')) || wb.getWorksheet('Data') || wb.worksheets[0];
  if (!ws) return [];
  const templateMetadata = readTemplateMetadataFromSheet(wb);
  const fieldKeySet = readFieldKeysFromMetadataSheet(wb);
  const forcedHeaderRow = Number(templateMetadata?.dataHeaderRow || 0);
  const forcedDataStartRow = Number(templateMetadata?.dataStartRow || 0);

  const rows = [];
  let headers = [];
  const headerProbeRow = forcedHeaderRow > 0 ? forcedHeaderRow : 1;
  const possibleHeader = ws.getRow(headerProbeRow).values.slice(1).map((v) => normalizeWorksheetValue(v).trim().toLowerCase());

  const keyCol = possibleHeader.indexOf('key');
  const valueCol = possibleHeader.indexOf('value');
  if (keyCol >= 0 && valueCol >= 0) {
    const rowObj = {};
    const kvStart = forcedDataStartRow > 0 ? forcedDataStartRow : (headerProbeRow + 1);
    for (let rowNumber = kvStart; rowNumber <= ws.rowCount; rowNumber++) {
      const row = ws.getRow(rowNumber).values.slice(1);
      const keyCell = row[keyCol];
      const valueCell = row[valueCol];
      if (keyCell === null || keyCell === undefined) continue;
      const keyRaw = normalizeWorksheetValue(keyCell).trim();
      if (!keyRaw) continue;
      const key = keyRaw.endsWith(' *') ? keyRaw.slice(0, -2) : keyRaw;
      if (!key || ['validationNotes', 'missingRequiredFields', 'rowQualityScore', 'firstIssue'].includes(key)) continue;
      rowObj[key] = normalizeWorksheetValue(valueCell);
    }

    const hasAnyValue = Object.values(rowObj).some((value) => String(value).trim() !== '');
    return hasAnyValue ? [rowObj] : [];
  }

  let headerRowIndex = forcedHeaderRow > 0 ? forcedHeaderRow : detectHeaderRowIndex(ws);
  if (fieldKeySet && headerRowIndex === 1) {
    const rowTwoValues = ws.getRow(headerProbeRow + 1).values
      .slice(1)
      .map((value) => normalizeWorksheetValue(value).trim())
      .filter(Boolean);
    if (rowTwoValues.length > 0) {
      headerRowIndex = headerProbeRow + 1;
    }
  }
  let dataStartRow = forcedDataStartRow > 0 ? forcedDataStartRow : (headerRowIndex + 1);

  const possibleTypeRowValues = ws.getRow(dataStartRow).values.slice(1).map((value) => normalizeWorksheetValue(value));
  if (forcedDataStartRow <= 0 && isLikelyValueTypeRow(possibleTypeRowValues)) {
    dataStartRow += 1;
  }

  const firstInputNote = ws.getCell(dataStartRow, 1).note;
  if (forcedDataStartRow <= 0 && typeof firstInputNote === 'string' && /example row|ligne d'exemple|linha de exemplo/i.test(firstInputNote)) {
    dataStartRow += 1;
  }

  const isAggregateValueKey = (key) => /^de_[A-Za-z0-9]{11}(?:__coc_[A-Za-z0-9]{11})?(?:__.*)?$/.test(String(key || ''));
  let hasAggregateValueColumns = false;
  let aggregateValueKeys = [];

  ws.eachRow((row, rowNumber) => {
    const values = row.values.slice(1); // ExcelJS uses 1-based, index 0 is empty
    if (rowNumber === headerRowIndex) {
      const normalizedHeaderValues = values.map((value) => {
        const raw = normalizeWorksheetValue(value).trim();
        return raw.endsWith(' *') ? raw.slice(0, -2) : raw;
      });

      const headerLooksLikeKeys = normalizedHeaderValues
        .filter(Boolean)
        .some((value) => looksLikeTemplateKey(value));

      if (fieldKeySet && !headerLooksLikeKeys) {
        const orderedFieldKeys = Array.from(fieldKeySet);
        headers = values.map((_, i) => orderedFieldKeys[i] || null);
      } else {
        headers = normalizedHeaderValues.map((value, i) => {
          const normalized = value || `col${i + 1}`;
          if (['validationNotes', 'missingRequiredFields', 'rowQualityScore', 'firstIssue'].includes(normalized)) return null;
          if (fieldKeySet && !fieldKeySet.has(normalized)) return null;
          return normalized;
        });
      }

      aggregateValueKeys = headers.filter((key) => key && isAggregateValueKey(key));
      hasAggregateValueColumns = aggregateValueKeys.length > 0;
    } else if (rowNumber >= dataStartRow) {
      const obj = {};
      headers.forEach((h, i) => {
        if (!h) return;
        const cell = values[i];
        obj[h] = normalizeWorksheetValue(cell);
      });

      const firstCellText = normalizeWorksheetValue(values[0]).trim();
      if (/^entry range ends above\.|^la plage de saisie se termine ci-dessus\.|^o intervalo de entrada termina acima\./i.test(firstCellText)) return;

      if (hasAggregateValueColumns) {
        const hasEnteredAggregateValue = aggregateValueKeys.some((key) => {
          const value = obj[key];
          return value !== null && value !== undefined && String(value).trim() !== '';
        });
        if (!hasEnteredAggregateValue) return;
      }

      const hasAnyValue = Object.values(obj).some((v) => String(v).trim() !== '');
      if (!hasAnyValue) return;
      rows.push(obj);
    }
  });

  return rows;
}

async function excelToJsonWithMetadata(buffer, { includeRows = true } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const metaSheet = getWorksheetByAliases(wb, templateSheetAliases('sheetMetadataSnapshot')) || wb.getWorksheet('Template Meta');
  const metadata = {};
  if (metaSheet) {
    for (let rowNumber = 2; rowNumber <= metaSheet.rowCount; rowNumber++) {
      const key = normalizeWorksheetValue(metaSheet.getCell(rowNumber, 1).value).trim();
      if (!key) continue;
      const value = metaSheet.getCell(rowNumber, 2).value;
      metadata[key] = normalizeWorksheetValue(value);
    }
  }

  const completionSheet = getWorksheetByAliases(wb, templateSheetAliases('sheetCompletion'));
  const completionIntent = {};
  if (completionSheet) {
    for (let rowNumber = 2; rowNumber <= completionSheet.rowCount; rowNumber++) {
      const fieldRaw = normalizeWorksheetValue(completionSheet.getCell(rowNumber, 1).value).trim();
      const valueRaw = completionSheet.getCell(rowNumber, 2).value;
      if (!fieldRaw) continue;
      const value = normalizeWorksheetValue(valueRaw).trim();

      if (fieldRaw === 'submissiondecision') {
        completionIntent.submissionDecision = value;
        completionIntent.completed = /submit and mark complete/i.test(value) ? 'true' : 'false';
      }
      if (fieldRaw === 'submissioncomment') completionIntent.submissionComment = value;
      if (fieldRaw === 'completed') completionIntent.completed = value;
      if (fieldRaw === 'completionDate') completionIntent.completionDate = value;
    }
  }

  const uidFieldMappingSheet = wb.getWorksheet(UID_MAPPING_SHEET_NAME);
  const uidFieldMapping = {};
  if (uidFieldMappingSheet) {
    const mappingHeaders = [];
    uidFieldMappingSheet.eachRow((mappingRow, rowNumber) => {
      const values = mappingRow.values.slice(1).map((value) => normalizeWorksheetValue(value).trim());
      if (rowNumber === 1) {
        values.forEach((value) => mappingHeaders.push(String(value || '').trim()));
        return;
      }

      if (mappingHeaders.length === 0) return;
      const fieldKeyIndex = mappingHeaders.indexOf('fieldKey');
      if (fieldKeyIndex < 0) return;

      const fieldKey = String(values[fieldKeyIndex] || '').trim();
      if (!fieldKey) return;

      const entry = {};
      mappingHeaders.forEach((header, index) => {
        if (!header) return;
        entry[header] = String(values[index] || '').trim();
      });
      uidFieldMapping[fieldKey] = entry;
    });
  }

  const startSheet = getWorksheetByAliases(wb, templateSheetAliases('sheetStartHere'));
  if (startSheet) {
    for (let rowNumber = 2; rowNumber <= startSheet.rowCount; rowNumber++) {
      const labelRaw = normalizeWorksheetValue(startSheet.getCell(rowNumber, 1).value).trim();
      if (!labelRaw) continue;
      const label = labelRaw.replace(/\s+/g, ' ').trim().toLowerCase();
      const labelAscii = label
        .normalize('NFD')
        .replace(/\p{M}/gu, '');
      const value = normalizeWorksheetValue(startSheet.getCell(rowNumber, 2).value).trim();

      if (label === 'submission decision:' || label === 'submission decision') {
        completionIntent.submissionDecision = value;
        completionIntent.completed = /submit and mark complete/i.test(value) ? 'true' : 'false';
      }
      if (label === 'submission comment:' || label === 'submission comment') {
        completionIntent.submissionComment = value;
      }
      if (label === 'period:' || label === 'period') {
        completionIntent.period = value;
      }
      if (
        label === 'selected org units'
        || labelAscii === 'unites org selectionnees'
        || labelAscii === 'unidades org selecionadas'
      ) {
        completionIntent.selectedOrgUnits = value;
      }
    }
  }

  // Read the hidden UID Mapping sheet for idempotent re-import
  const uidMappingSheet = wb.getWorksheet(UID_IDENTITY_SHEET_NAME) || wb.getWorksheet('Import Identity Mapping') || wb.getWorksheet(UID_MAPPING_SHEET_NAME);
  const uidMapping = {};
  if (uidMappingSheet) {
    const mappingHeaders = [];
    uidMappingSheet.eachRow((mappingRow, rowNumber) => {
      const values = mappingRow.values.slice(1);
      if (rowNumber === 1) {
        values.forEach((v) => mappingHeaders.push(normalizeWorksheetValue(v).trim().toLowerCase().replace(/\s+/g, '')));
        return;
      }
      if (mappingHeaders.length === 0) return;
      const entry = {};
      mappingHeaders.forEach((header, i) => {
        if (header) entry[header] = normalizeWorksheetValue(values[i]).trim();
      });
      const key = entry.stableimportkey || '';
      if (key) uidMapping[key] = entry;
    });
  }

  const rows = includeRows ? await excelToJson(buffer) : [];
  return { rows, metadata, completionIntent, uidMapping, uidFieldMapping };
}

module.exports = {
  jsonToCsv,
  jsonToExcel,
  jsonToPdf,
  buildTemplateWorkbook,
  csvToJson,
  excelToJson,
  excelToJsonWithMetadata,
  TEMPLATE_SCHEMA_VERSION,
  TEMPLATE_GENERATOR_VERSION,
};
