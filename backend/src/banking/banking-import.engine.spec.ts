import { BankImportFormat } from '@prisma/client';
import { BankingImportEngine, CategorizationRuleCandidate } from './banking-import.engine';

function bankFile(content: string, filename = 'bank.csv') {
  return { filename, buffer: Buffer.from(content) };
}

describe('BankingImportEngine', () => {
  const engine = new BankingImportEngine();

  it('parses CSV preamble, quoted columns, auto-mapping, normalization, and duplicates', () => {
    const csv =
      `Account: Operating checking\n` +
      `Date,Description,Amount,Reference\n` +
      `2026-10-01,"Coffee, Inc.",-12.50,REF-1\n` +
      `10/02/2026,Customer deposit,1200.00,REF-2\n`;

    const first = engine.analyze(bankFile(csv));
    expect(first.format).toBe(BankImportFormat.CSV);
    expect(first.headers).toEqual(['Date', 'Description', 'Amount', 'Reference']);
    expect(first.mapping).toMatchObject({
      date: 'Date',
      description: 'Description',
      amount: 'Amount',
      externalId: 'Reference',
    });
    expect(first.mappingError).toBeNull();
    expect(first.counts).toEqual({ total: 2, valid: 2, invalid: 0, duplicate: 0, newCount: 2 });
    expect(first.rows[0]).toMatchObject({
      date: '2026-10-01',
      description: 'Coffee, Inc.',
      amount: -12.5,
      externalId: 'REF-1',
      valid: true,
      duplicate: false,
    });
    expect(first.rows[1].date).toBe('2026-10-02');

    const second = engine.analyze(
      bankFile(csv),
      {},
      new Set([first.rows[0].fingerprint!]),
    );
    expect(second.rows[0].duplicate).toBe(true);
    expect(second.rows[1].duplicate).toBe(false);
    expect(second.counts).toMatchObject({ valid: 2, duplicate: 1, newCount: 1 });
  });

  it('maps debit and credit columns and normalizes signed amounts', () => {
    const csv =
      `When,Details,Withdrawal,Deposit\n` +
      `10/01/2026,"Check 1042",100.00,\n` +
      `10/03/2026,Customer payment,,250.50\n`;

    const unmapped = engine.analyze(bankFile(csv));
    expect(unmapped.mappingError).toBe('Choose the date column.');

    const mapped = engine.analyze(bankFile(csv), {
      date: 'When',
      description: 'Details',
      debit: 'Withdrawal',
      credit: 'Deposit',
    });
    expect(mapped.mappingError).toBeNull();
    expect(mapped.rows).toHaveLength(2);
    expect(mapped.rows[0]).toMatchObject({
      date: '2026-10-01',
      description: 'Check 1042',
      amount: -100,
    });
    expect(mapped.rows[1]).toMatchObject({
      date: '2026-10-03',
      description: 'Customer payment',
      amount: 250.5,
    });
  });

  it('parses OFX transactions with FITIDs and reports invalid rows', () => {
    const ofx =
      `OFXHEADER:100\n` +
      `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>\n` +
      `<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261001120000[-5:EST]<TRNAMT>-84.25` +
      `<FITID>FIT-1<NAME>OFFICE SUPPLIES<MEMO>Paper</STMTTRN>\n` +
      `<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261003<TRNAMT>1200.00` +
      `<FITID>FIT-2<NAME>INVOICE PAYMENT</STMTTRN>\n` +
      `</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>\n`;

    const analysis = engine.analyze(bankFile(ofx, 'activity.ofx'));
    expect(analysis.format).toBe(BankImportFormat.OFX);
    expect(analysis.headers).toEqual([]);
    expect(analysis.mapping).toBeNull();
    expect(analysis.counts).toEqual({ total: 2, valid: 2, invalid: 0, duplicate: 0, newCount: 2 });
    expect(analysis.rows[0]).toMatchObject({
      date: '2026-10-01',
      description: 'OFFICE SUPPLIES — Paper',
      amount: -84.25,
      externalId: 'FIT-1',
    });

    const duplicate = engine.analyze(
      bankFile(ofx, 'activity.ofx'),
      {},
      new Set([analysis.rows[1].fingerprint!]),
    );
    expect(duplicate.counts).toMatchObject({ valid: 2, duplicate: 1, newCount: 1 });
    expect(duplicate.rows[1].duplicate).toBe(true);
  });


  it('applies one deterministic rule per transaction by priority and age', () => {
    const csv =
      `Date,Description,Amount\n` +
      `2026-10-01,FUEL STOP 882,-64.20\n` +
      `2026-10-02,MONTHLY BANK FEE,-18.00\n` +
      `2026-10-03,CUSTOMER DEPOSIT,1200.00\n`;
    const analysis = engine.analyze(bankFile(csv));
    const account = (id: string, code: string, name: string) => ({
      id,
      code,
      name,
      type: 'EXPENSE',
    });
    const rule = (
      id: string,
      descriptionContains: string,
      priority: number,
      createdAt: string,
      targetAccountId: string,
      targetCode: string,
      targetName: string,
      active = true,
    ): CategorizationRuleCandidate => ({
      id,
      descriptionContains,
      priority,
      createdAt,
      active,
      targetAccountId,
      targetAccount: account(targetAccountId, targetCode, targetName),
    });

    const rows = engine.applyRules(analysis.rows, [
      rule('fuel', 'fuel', 200, '2026-01-01T00:00:00.000Z', 'acct-fuel', '6300', 'Fuel'),
      rule(
        'fuel-stop',
        'fuel stop',
        50,
        '2026-02-01T00:00:00.000Z',
        'acct-travel',
        '6400',
        'Travel',
      ),
      rule('fee-old', 'bank fee', 100, '2026-01-01T00:00:00.000Z', 'acct-fees', '6500', 'Fees'),
      rule('fee-new', 'bank', 100, '2026-03-01T00:00:00.000Z', 'acct-other', '6600', 'Other'),
      rule('paused', 'customer deposit', 1, '2026-01-01T00:00:00.000Z', 'acct-hold', '6700', 'Hold', false),
    ]);

    expect(rows[0].rule).toMatchObject({
      id: 'fuel-stop',
      descriptionContains: 'fuel stop',
      targetAccountId: 'acct-travel',
      targetAccount: { code: '6400', name: 'Travel' },
    });
    expect(rows[1].rule).toMatchObject({ id: 'fee-old', targetAccountId: 'acct-fees' });
    expect(rows[2].rule).toBeNull();
  });

  it('flags invalid dates, descriptions, and amounts instead of dropping rows', () => {
    const csv =
      `Date,Description,Amount\n` +
      `2026-02-30,Bad date,10.00\n` +
      `2026-10-01,,20.00\n` +
      `2026-10-02,Missing amount,\n`;

    const analysis = engine.analyze(bankFile(csv));
    expect(analysis.mappingError).toBeNull();
    expect(analysis.counts).toEqual({ total: 3, valid: 0, invalid: 3, duplicate: 0, newCount: 0 });
    expect(analysis.rows[0].error).toContain('invalid date');
    expect(analysis.rows[1].error).toContain('Missing description');
    expect(analysis.rows[2].error).toContain('Missing or invalid amount');
  });
});
