import { describe, expect, it } from 'vitest'
import { toCsv } from '../../src/shared/csv.js'

describe('exportacion CSV', () => {
  it('protege formulas y controles iniciales y conserva celdas con separadores', () => {
    expect(toCsv([['=1+1', '+2', '-3', '@SUM(A1)', '\t=1', '\r=1', 'Calle;1', '"texto"']])).toBe(
      '\uFEFF\'=1+1;\'+2;\'-3;\'@SUM(A1);\'\t=1;"\'\r=1";"Calle;1";"""texto"""\r\n',
    )
  })
})
