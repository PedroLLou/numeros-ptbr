# numeros-ptbr

Português · [English](README.en.md)

CI: [Node 22/24 em Linux e Windows](https://github.com/PedroLLou/numeros-ptbr/actions/workflows/ci.yml).

Lista os números que um texto em português do Brasil afirma e confere se cada um tem um fato registrado, com fonte. A entrada pode ser texto ou Markdown, um arquivo de legenda SRT ou uma lista de palavras com tempo (saída de transcrição).

Pergunta única: **"todo número deste texto está amparado por uma entrada no meu arquivo de fatos?"** Para cada número que não está, mostra o número, a linha e a coluna (ou a legenda / palavra e o tempo de início) e a frase em volta.

**Não é um verificador de fatos.** Não sabe se o fato é verdadeiro, se a fonte existe ou se a frase usa o número corretamente. "Amparado" só quer dizer que o autor registrou aquele valor e unidade com uma fonte. Um relatório limpo significa "nada sem registro", não "nada errado".

> Estado: inicial. A primeira publicação é este repositório no GitHub (`PedroLLou/numeros-ptbr`); não há release no npm (`"private": true`) e a disponibilidade do nome no npm não foi verificada. Node >= 22, ESM, sem dependências de execução, sem acesso à rede.

## O que lê

- Dígitos em pt-BR: `20`, `1,5`, `1.234,56`, `3 mil`, `2,5 milhões`.
- Porcentagem: `20%`, `20 por cento`, `vinte por cento`.
- Reais: `R$ 49,90`, `20 reais`, `50 centavos`, `2 milhões de reais`.
- Datas: `05/03/2026`, `5/3`, `2026-03-05`, `5 de março de 2026`, `cinco de março de 2026`.
- Por extenso, de 0 a 999 999 999 999: `cento e vinte`, `duzentas e cinquenta`, `dois mil e vinte e seis`, `três vírgula cinco`. Ignora maiúsculas e acentos.

A comparação é exata em **unidade e valor** (`number`, `percent`, `BRL`, `date`): `20 reais` não é `20%`, `20` não é parte de `120`, `1.234,56` não é `1,5`. Valores são decimais canônicos em texto, nunca ponto flutuante.

## Uso

```sh
node bin/numeros-ptbr.mjs check fixtures/script-findings.txt --facts fixtures/facts.json
node bin/numeros-ptbr.mjs extract fixtures/sample.srt --json
```

Opções: `--facts <arquivo>`, `--format text|srt|words` (padrão: pela extensão), `--json`, `--include-articles`, `--verbose`, `-` para ler a entrada padrão.

Códigos de saída: **0** sem achados; **1** achados (número sem fato ou texto numérico ilegível); **2** entrada ou uso inválido (arquivo ilegível, pasta, UTF-8 inválido, fatos/SRT/words malformados, opção desconhecida).

Só lê os arquivos que você indica. Não abre pastas, não expande padrões, não busca URLs, não chama serviços. O pacote não está publicado no npm: use a partir de um checkout deste repositório.

## Arquivo de fatos

```json
{
  "version": 1,
  "facts": [
    { "id": "preco-plano", "value": "49.90", "unit": "BRL", "source": "https://example.com/pricing" }
  ],
  "ignore": [
    { "value": 2026, "reason": "O ano corrente como rótulo, não uma afirmação." }
  ]
}
```

`id`, `value` e `source` são obrigatórios e não vazios. `value` é número JSON ou decimal com ponto (`"1234.56"`; sem `1.234,56`, `%` ou `R$`). `unit` é opcional (`number`, `percent`, `BRL`, `date`). `source` é URL `http(s)` ou referência explícita e **nunca é acessada**. `context` é só informativo. Cada regra de `ignore` exige `reason`. Chaves desconhecidas e tipos errados são erros, listados com o caminho.

## O que fica de fora

Nada é descartado em silêncio: pulos por heurística (`um/uma` isolado, `do zero`, horários, identificadores, ordinais) são contados no relatório (`--verbose` lista), e texto que parece número mas não pode ser lido (`3.5`, `31 de fevereiro`, `dois milhões e meio`) é **achado** com saída 1. Não há suporte a sinal negativo, frações, outras moedas além de BRL, nem a decimais por extenso dígito a dígito. Markdown não é interpretado: número dentro de URL ou bloco de código ainda é número. A referência técnica detalhada está no [README em inglês](README.en.md).

Quantidades com sinal, como `-20%`, `−20%` e `menos vinte por cento`, viram achados
`unsupported-sign`; não correspondem ao valor positivo cadastrado. A checagem
olha até 32 caracteres antes da referência. Um marcador de lista Markdown antes
do número também pode exigir revisão.

## Uso como biblioteca

```js
import { check, readSource, parseFactsJson, formatReport } from './src/index.mjs';
import { readFileSync } from 'node:fs';

const facts = parseFactsJson(readFileSync('facts.json', 'utf8'));
const source = readSource('srt', readFileSync('video.srt', 'utf8'));
const report = check(source, facts);
if (!report.clean) process.stdout.write(formatReport(report));
```

As declarações TypeScript estão em `src/index.d.mts`. Entradas inválidas lançam
`InputError`, com `code` e `details`. Nomes dos campos da API e códigos dos
relatórios permanecem em inglês.

## Formatos e localização

- **text**: texto ou Markdown, sem interpretação da marcação.
- **srt**: SubRip. Índices e tempos das legendas não entram na análise. Marcações
  como `<i>` são apagadas. Um número pode continuar entre linhas e legendas.
  O relatório indica linha, coluna, legenda e tempo inicial. WebVTT é rejeitado.
- **words**: lista JSON de `{ "word", "start" }`, com `end` opcional, ou um objeto
  `{ "words": [...] }`. As palavras são unidas por espaços. `start` deve estar em
  segundos, em ordem não decrescente. Campos extras como `confidence` são ignorados.

Linhas e colunas começam em 1; a coluna conta unidades UTF-16. Um marcador BOM
inicial é removido antes do cálculo das posições.

## Limites

Disponíveis na API como `LIMITS` e `THRESHOLDS`.

| Item | Limite |
| --- | --- |
| Entrada (arquivo ou entrada padrão) | 4 MiB |
| Arquivo de fatos | 1 MiB |
| Fatos e regras de omissão | 5000 de cada |
| Legendas SRT / palavras | 100 000 / 500 000 |
| Linha SRT | 2000 caracteres |
| Dígitos | 24 inteiros e 12 decimais |
| Número por extenso | 0 a 999 999 999 999 |
| Letras da unidade junto ao número (`20kg`) | Até 4 |
| Intervalo `5-10` | Até 4 dígitos simples de cada lado; fora disso, identificador |
| Trecho exibido | Até 160 caracteres, com busca de 400 para cada lado |

## Testes

```sh
npm test
npm run example
npm run pack:dry
```

Fixtures sintéticas, sem rede. Veja [SECURITY.md](SECURITY.md) e [PROVENANCE.md](PROVENANCE.md).

## Licença

MIT, copyright 2026 Pedro Lourenconi Lima. A licença cobre apenas o código deste pacote.
