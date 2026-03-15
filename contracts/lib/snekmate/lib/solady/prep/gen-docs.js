#!/usr/bin/env node
const path = require('node:path');
const {
  readSync,
  writeSync,
  forEachWalkSync,
  hasAnyPathSequence,
  readSolWithLineLengthSync,
  normalizeNewlines
} = require('./common.js');

async function main() {
  const pathSequencesToIgnore = ['g', 'ext', 'legacy'];

  const cleanForRegex = s => s.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  
  const makeTagRegex = tag => new RegExp(
    `${String.raw`(<!--\s?` + cleanForRegex(tag)  }:start\\s?-->)([\s\S]*?)${  
    String.raw`(<!--\s?`  }${cleanForRegex(tag)  }${String.raw`:end\s?-->)`}`
  );

  const has = (a, b) => a.toLowerCase().includes(b.toLowerCase());

  const strip = s => s.replaceAll(/^\s+|\s+$/g, '');

  const replaceInTag = (s, tag, replacement) =>
    s.replace(
      makeTagRegex(tag),
      (m0, m1, m2, m3) => `${m1  }\n${  strip(replacement)  }\n${  m3}` 
    );

  const getTag = (s, tag) => {
    const m = s.match(makeTagRegex(tag));
    if (m === null) return `<!-- ${  tag  }:start -->` + `<!-- ${  tag  }:end -->`;
    return m[0];
  };

  const coalesce = (m, f) => m === null ? '' : f(m);
  
  const toHeaderCase = string_ =>
    strip(string_).toLowerCase()
    .replaceAll(/(eth|sha|lz|uups|(eip|rip|erc|push|create)\-?[0-9]+i?)/g, m => m.toUpperCase())
    .split(/\s+/)
    .map(w => w.replace(/^([a-zA-Z])/, c => c.toUpperCase()))
    .join(' ');

  const deindent = s => s.replaceAll(/^ {4}/gm, '');

  const getFunctionSig = s => coalesce(
    s.match(/(\w+)\s*\(([^)]*)\)/),
    m => `${m[1]  }(${  m[2].split(',').map(x => strip(x).split(/\s+/)[0])  })`
  );

  const cleanNatspecOrNote = s => deindent(strip(
    s.replaceAll(/\s+\/\/\/?/g, '\n')
    .replaceAll(/\s?\n\s?/g, '   \n')
    .replaceAll(/```([\s\S]+?)```/g, '```solidity$1```')
    .replace(/^\/\/\/\s+@[a-z]+\s?/, '')
    .replaceAll(/\n\s*?((?:Note|Requirement)s?)\:[\s\/]*?(\-)/gi, '\n\n<b>$1:</b>\n\n$2')
    .replaceAll(/\n\s*?(Emits)/gi, '\n\n$1')
    .replaceAll(/\{([A-Za-z0-9\-]+)\}/g, '`$1`')
  ));

  const getSections = s => {
    const sectionHeaderRe = /\/\*\S+?\*\/\s*\/\*([^*]{60})\*\/\s*\/\*\S+?\*\//g;
    let a = [], l = null;
    for (let m = null; (m = sectionHeaderRe.exec(s)) !== null; l = m) {
      if (l !== null) {
        a.push({
          h2: toHeaderCase(l[1]),
          src: s.slice(l.index + l[0].length, m.index)
        });
      }
    }
    if (l !== null) {
      a.push({
        h2: toHeaderCase(l[1]),
        src: s.slice(l.index + l[0].length)
      });
    }
    return a
      .filter(x => !has(x.h2, 'private'))
      .map(item => {
        const m = item.src.match(/^((\s+\/\/\s[^\n]+)+)/);
        if (m) item.note = cleanNatspecOrNote(m[0]);
        return item;
      });
  };

  const getSubSections = (s, r) => {
    const a = [];
    for (let m = null; (m = r.exec(s)) !== null; ) {
      if (!has(m[2], '///') && !/\sprivate\s/.test(m[2])) a.push(m);
    }
    return a;
  }

  const getFunctionsAndModifiers = s =>
    getSubSections(s, /((?:\/\/\/\s[^\n]+\n\s*?)+)((?:function|fallback|receive|modifier)[^{]+)/g)
    .map(m => ({
      natspec: cleanNatspecOrNote(m[1]), 
      def: deindent(strip(m[2])),
      h3: getFunctionSig(deindent(strip(m[2])))
    }));

  const getConstantsAndImmutables = s => 
    getSubSections(s, /((?:\/\/\/\s[^\n]+\n\s*?)+)((?:bytes|uint|address)[0-9]*\s+(?:public|internal)\s+(?:immutable|constant)\s+([A-Za-z0-9_]+)[^;]*)/g)
    .map(m => ({
      natspec: cleanNatspecOrNote(m[1]), 
      def: deindent(strip(m[2])),
      h3: deindent(strip(m[3]))
    }));
    
  const getCustomErrors = s =>
    getSubSections(s, /((?:\/\/\/\s[^\n]+\n\s*?)+)(error\s[^;]+);/g)
    .map(m => ({
      natspec: cleanNatspecOrNote(m[1]), 
      def: deindent(strip(m[2])),
      h3: getFunctionSig(deindent(strip(m[2])))
    }));

  const getEvents = s =>
    getSubSections(s, /((?:\/\/\/\s[^\n]+\n\s*?)+)(event\s[^;]+);/g)
    .map(m => ({
      natspec: cleanNatspecOrNote(m[1]), 
      def: deindent(strip(m[2])),
      h3: getFunctionSig(deindent(strip(m[2])))
    }));

  const getStructsAndEnums = s =>
    getSubSections(s, /((?:\/\/\/\s[^\n]+\n\s*?)+)((?:struct|enum)\s([A-Za-z0-9_]+)\s+\{[^}]+})/g)
    .map(m => ({
      natspec: cleanNatspecOrNote(m[1]), 
      def: deindent(strip(m[2])),
      h3: deindent(strip(m[3]))
    }));

  const getNotice = s => coalesce(
    s.match(/\/\/\/\s+@notice\s+([\s\S]+?)\/\/\/\s?@author/), 
    m => m[1].replaceAll('\n///', '')
  );

  const getImports = (s, sourcePath) => {
    const r = /import\s[\s\S]*?(["'][\s\S]+?["'])/g;
    const a = [];
    for (let m = null; (m = r.exec(s)) !== null; ) {
      const p = path.normalize(path.join(path.dirname(sourcePath), m[1].slice(1, -1)));
      a.push(p.split(path.sep).slice(-2).join(path.sep));
    }
    return a;
  };

  const getTopIntro = s => coalesce(
    s.match(/\/\/\/\s+@notice\s+[\s\S]+?(?:\/\/\/\s?@author\s+[\s\S]+?\n|\/\/\/\s+\([\s\S]+?\)\n)+([\s\S]*?)(?:library|abstract\s+contract|contract)\s[^.]+\{/), 
    m => normalizeNewlines(strip(
      m[1].replace('\n\n', '\n\n\n').split('\n')
      .map(l => l
        .replaceAll(/(\d\d)\:(\d\d)\:/g, '$1&#58;$2&#58;')
        .replace(/^\/{2,3}\s{2,3}([1-9][0-9]*?)\.\s/, '    $1. ')
        .replace(/^\/{2,3}\s*/, '')
        .replace(/^(-\s+[\s\S]{1,64})\:/, '$1&#58;')
        .replace(/^@dev\s?([\s\S]+?)\:/, '$1:\n\n')
        .replace(/^Note\:/, 'Note:\n\n')
        .replace(/^[\s\S]{1,64}\:/, m => has(m, 'http') ? m : `<b>${  m  }</b>`)
      ).join('\n')
      .replace(/\.\n\<b\>([\s\S]+?)\:\<\/b\>/, '. $1:')
      .replaceAll(/@dev\s/g, '')
      .replaceAll(/\-{32,}\s?\+\s*?([\s\S]+)\-{32,}\s?\+/g, (m0, m1) => {
        const lines = strip(m1.replaceAll(/\-+\s*$/g, '')).split('\n');
        const n = Math.max.apply(null, lines.map(l => l.split('|').map(strip).filter(c => c.length).length));
        const h = `|${  new Array(n + 1).join(' -- |')}`;
        return `\n\n${  lines.map(l => /\-{32,}\s?\|/.test(l) ? h : `| ${  l}`).join('\n')  }\n\n`;
      })
    ))
  );

  const getInherits = (s, sourcePath) => coalesce(
    s.match(/contract\s+[A-Za-z0-9_]+\s+is\s+([^\{]*?)\s*\{/),
    m => `<b>Inherits:</b>  \n\n${ 
      m[1].split(',').map(strip).map(p => 
        getImports(s, sourcePath).map(q => has(q, p) ? `- \`${  q  }\`  \n` : '').join('')
      ).join('')}`
  );

  const getSrcDir = sourcePath => sourcePath.split(path.sep).slice(-2)[0];
  const getTitle = sourcePath => path.parse(sourcePath).name;
  const getDocumentSubPath = sourcePath => path.join(getSrcDir(sourcePath), `${getTitle(sourcePath).toLowerCase()  }.md`);
  const getDocumentPath = sourcePath => path.join('docs', getDocumentSubPath(sourcePath));

  const documentSourcePaths = [];

  forEachWalkSync(['src'], sourcePath => {
    if (!/\.sol$/i.test(sourcePath)) return;
    if (hasAnyPathSequence(sourcePath, pathSequencesToIgnore)) return;
    if (has(sourcePath, 'Milady.sol')) return;
    console.log(sourcePath);

    let source = readSolWithLineLengthSync(sourcePath, 80);
    let sections = getSections(source);

    if (sections.length === 0) {
      source = source.replace(
        /(library|contract)\s[\s\S]*?\{/, 
        m => `${m  
          }/*============================================================*/\n` + 
          `/*                         FUNCTIONS                          */\n` + 
          `/*============================================================*/\n`
      );
      sections = getSections(source);
    }

    const documentHeader = `# ${  getTitle(sourcePath)  }\n\n${  getNotice(source)}`;
    const documentChunks = [];
    for (const x of sections) {for (const [index, y] of [
        getStructsAndEnums,
        getCustomErrors,
        getEvents,
        getFunctionsAndModifiers,
        getConstantsAndImmutables
      ]
      .reduce((accumulator, f) => accumulator.length > 0 ? accumulator : f(x.src), []).entries()) {documentChunks.push(
          ...(index ? [] : [`## ${  x.h2}`, ...(x.note ? [x.note] : [])]),
          `### ${  y.h3}`, 
          `\`\`\`solidity\n${  y.def  }\n\`\`\``, 
          y.natspec
        )
      
    ;}}

    if (documentChunks.length > 0) {
      writeSync(
        getDocumentPath(sourcePath),
        [
          documentHeader, 
          getTopIntro(source),
          getInherits(source, sourcePath),
          getTag(readSync(getDocumentPath(sourcePath)), 'customintro'), 
          documentChunks.join('\n\n')
        ].join('\n\n')
      );
      documentSourcePaths.push(sourcePath);
    }
  });

  if (documentSourcePaths.length > 0) {
    for (const p of documentSourcePaths) {
      writeSync(
        getDocumentPath(p),
        readSync(getDocumentPath(p))
        .replaceAll(/((?:See\:)?\s)`([A-Za-z0-9\/]+?\.sol)`/ig, (m0, m1, m2) => {
          if (!/^See\:/i.test(m0) && !/\.sol$/i.test(m2)) return m0;
          const l = documentSourcePaths.filter(q => has(q, getTitle(m2)));
          return l.length > 0 ? `${m1  }[\`${  m2  }\`](${  getDocumentSubPath(l[0])  })` : m0;
        })
      );
    }
    const sidebarDocumentPath = path.join('docs', 'sidebar.md');
    writeSync(
      sidebarDocumentPath, 
      replaceInTag(
        readSync(sidebarDocumentPath),
        'gen',
        [...new Set(documentSourcePaths.map(getSrcDir))]
        .map(dir => `- ${  dir  }\n${ 
          documentSourcePaths
          .filter(p => getSrcDir(p) === dir)
          .map(p => `  - [${  getTitle(p)  }](${  getDocumentSubPath(p)  })`)
          .join('\n')}`
        ).join('\n')
      )
    );
  }
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
