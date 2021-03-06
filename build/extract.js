/*!***************************************************
 * diacritics - extract characters
 * http://diacritics.io/
 * Copyright (c) 2016-2017, Diacritics Team
 * Released under the MIT license https://git.io/vXg2H
 *****************************************************/
'use strict';
const fs = require('fs'), // file system
  path = require('path'),
  del = require('del'),
  stripMarks = require('strip-combining-marks'), // remove combining diacritics
  stripJsonComments = require('strip-json-comments'),
  alphabet = require( // get metadata.alphabet
    'cldr-data/supplemental/languageData'
  ).supplemental.languageData,
  langEn = require( // get metadata.language in English
    'cldr-data/main/en/languages'
  ).main.en.localeDisplayNames.languages;

/**
 * Extract
 * This class extracts the language `exemplarCharacters` directly from CLDR's
 * language data (main/{language}/characters.json). The list is processed:
 * - All plain characters (non-diacritics) are removed.
 * - Since ony lower case characters are provided, `toLocalLowerCase` and
 *   `toLocaleUpperCase` is used to obtain the cases.
 * - Base characters are generated by the stringMarks module. Some values use
 *   combining diacritics and must be normalized.
 * - Mapping is generated from character clusters data (https://goo.gl/szUBeM).
 * - Alphabet, continents and language are all extracted from CLDR data as well.
 */
class Extract {
  /**
   * Constructor
   */
  constructor() {
    this.results = {};
    this.langData = {};
    this.langNative = {};
    this.validLangs = [];
    this.continents = [];
    this.run();
  }

  /**
   * Load in extract settings
   */
  initSettings() {
    // get metadata.continents cross-reference
    this.initTSV();
    // load list of validated languages
    this.validLangs = this.readJSON('./src/validated-languages.json');
  }

  /**
   * Load continents.tsv cross-reference copied directly from wikipedia
   * https://goo.gl/qt0S54
   */
  initTSV() {
    const data = fs.readFileSync('./build/data/continents.tsv', 'utf8');
    this.continents = {
      'AF': [],
      'AS': [],
      'EU': [],
      'NA': [],
      'SA': [],
      'OC': [],
      'AN': []
    };
    data.split('\n').forEach(continent => {
      let line = continent.split('\t');
      // skip CR at file end
      if (line[1]) {
        // Add country to continent list
        this.continents[line[0]].push(line[1]);
      }
    });
  }

  /**
   * Extract language root from language string
   * e.g. "de-AT" language root is "de"
   * @param {string} language - IETF language tag
   * @return {string} - root language
   */
  getRootLang(language) {
    return language.split('-')[0];
  }

  /**
   * Reads a JSON file, removes comments and parses it
   * @param {string} file - path to json file
   * @return {object}
   */
  readJSON(file) {
    return JSON.parse(
      stripJsonComments(
        fs.readFileSync(file, 'utf8')
      )
    );
  }

  /**
   * Load a specific language JSON file
   * @param {string} lang - IETF language tag
   */
  loadLangFiles(lang) {
    if (!this.langData[lang]) {
      const path = `node_modules/cldr-data/main/${lang}/`;
      // get language alphabet to extract diacritics
      let data = this.readJSON(path + 'characters.json');
      this.langData[lang] = data || {};
      // get metadata.native value
      data = this.readJSON(path + 'languages.json');
      this.langNative[lang] =
        data.main[lang].localeDisplayNames.languages[lang] || {};
    }
  }

  /**
   * Build a list of languages from CLDR directory folder structure
   * @return {array}
   */
  buildLangList() {
    const folders = [],
      dir = 'node_modules/cldr-data/main';
    fs.readdirSync(dir).forEach(file => {
      if (fs.lstatSync(path.join(dir, file)).isDirectory()) {
        folders.push(file);
      }
    });
    return folders;
  }

  /**
   * Extract alphabet
   * @param {object} data - language data object
   * @return {array} - array of characters to check (a-z and A-Z removed)
   */
  extractAlphabet(data) {
    // e.g. lang "AF" exemplarCharacters returns (lower case only):
    // "[a á â b c d e é è ê ë f g h ... ô ö p q r s t u û v w x y z]"
    let alphabet = data.characters.exemplarCharacters,
      result = alphabet
        .substring(1, alphabet.length - 1)
        .replace(/[a-zA-Z]/g, '')
        .trim();
    // include upper and lower case characters
    return (
      `${result.toLocaleLowerCase()} ${result.toLocaleUpperCase()}`
    ).split(/\s+/);
  }

  /**
   * Convert an array of territories into an array of continents
   * @param {string} rootLang - IETF language tag
   * @return {array} - array of continents
   */
  getContinents(rootLang) {
    let continents = [],
      key = '_territories',
      contList = Object.keys(this.continents),
      alt = alphabet[rootLang + '-alt-secondary'],
      territories =
        (alphabet[rootLang] && alphabet[rootLang][key] || [])
          .concat(alt && alt[key] || []);
    if (territories.length) {
      territories.forEach(territory => {
        contList.forEach(continent => {
          if (
            !continents.includes(continent) &&
            this.continents[continent].includes(territory)
          ) {
            continents.push(continent);
          }
        });
      });
    }
    return continents;
  }

  /**
   * Returns an object with filled-in metadata properties of the given language
   * @param {string} language
   * @return {object}
   */
  getMetadata(language) {
    // get root language (ignore variants for alphabet data)
    const rootLang = this.getRootLang(language),
      alpha = alphabet[rootLang] || {},
      continents = this.getContinents(rootLang);
    return {
      metadata: {
        alphabet: alpha['_scripts'] && alpha['_scripts'][0] || '',
        continent: continents,
        language: langEn[rootLang] || '',
        native: this.langNative[rootLang],
        source: [
          'http://www.unicode.org/cldr/charts/latest/by_type/' +
          'core_data.alphabetic_information.main.html'
        ]
      },
      data: {}
    };
  }

  /**
   * Extract diacritics from alphabet string
   * @param {string} language - IETF Language tag
   * @param {object} file - Language JSON data
   */
  makeLangFile(language) {
    if (this.langData[language]) {
      const alphabet = this.langData[language].main[language],
        lang = this.getMetadata(language);
      let chars = this.extractAlphabet(alphabet);
      if (chars.length) {
        chars.forEach(char => {
          // some languages (e.g. "BS") include character clusters
          // "[a b c č ć d {dž} ... {lj} m n {nj} ... š t u v z ž]"
          if (char && !/^{.+}$/.test(char)) {
            // convert character into base letter + combining
            // diacritic then remove any combining diacritics
            let base = stripMarks(char.normalize('NFD'));
            if (base !== char && base !== '') {
              lang.data[char] = {
                mapping: {
                  base: base
                }
              };
            }
          }
        });
        this.results[language] = lang;
      }
    }
  }

  /**
   * Validate language results
   * - remove variants that exactly match the root
   * - write language file to "src" directory
   */
  validateList() {
    const languages = Object.keys(this.results);
    // assuming the first language listed isn't a variant
    let root = JSON.stringify(this.results[languages[0]]);
    languages.forEach(language => {
      let unique = true,
        isVariant = /-/.test(language) &&
          // make exception for "sr-Latn"
          !/^sr-Latn$/.test(language);
      const data = this.results[language];
      if (!isVariant) {
        root = JSON.stringify(data);
      }
      // skip validated languages
      if (!this.validLangs.includes(language) ||
        isVariant &&
        !this.validLangs.includes(this.getRootLang(language))
      ) {
        // target language variants
        if (isVariant) {
          // include variants that are different from the root
          // language
          if (JSON.stringify(data) === root) {
            unique = false;
          }
        }
        // write file if unique and it contains data
        if (unique && Object.keys(data.data).length) {
          this.writeOutput(language, data);
        }
      }
    });
  }

  /**
   * Writes the defined content into ./src/[lang]/[lang].json
   * @param {string} language - IETF Language tag
   * @param {object} data - Language JSON data to output
   */
  writeOutput(language, data) {
    let indx, temp,
      folder = language;
    if (/-/.test(language)) {
      // per spec... de/ would contain de.js, at.js & ch.js
      indx = language.indexOf('-');
      folder = language.substring(0, indx);
      // make exception for "sr-Latn"
      language = /^sr-Latn$/.test(language) ?
        folder :
        language.slice(indx + 1);
    }
    temp = `./src/${folder}/`;
    if (!fs.existsSync(temp)) {
      fs.mkdirSync(temp);
    }
    temp = `./src/${folder}/${language}.json`;
    if (!fs.existsSync(temp)) {
      const tpl = fs.readFileSync(
        './build/templates/extracted-language-variant.json', 'utf8'
      );
      fs.writeFileSync(
        temp,
        tpl.replace(/\/\/<%= contents %>/gmi, JSON.stringify(data, null, 2)),
        'utf8'
      );
    } else if (language !== 'sr') {
      // don't log "sr" (single exception)
      console.log(`ERROR: ${language} file already exists`);
    }
  }

  /**
   * Removes all auto-generated files in the src folder
   */
  clearBuild() {
    const dir = './src/';
    fs.readdirSync(dir).forEach(file => {
      // ignore variants
      let variant = this.getRootLang(file);
      if (
        fs.lstatSync(path.join(dir, file)).isDirectory() &&
        !this.validLangs.includes(variant)
      ) {
        del.sync([dir + file + '/**']);
      }
    });
  }

  /**
   * Runs the build
   */
  run() {
    this.initSettings();
    this.clearBuild();
    this.buildLangList().forEach(language => {
      this.loadLangFiles(language);
      this.makeLangFile(language);
    });
    this.validateList();
  }
}

// run the build
new Extract();
