-- GPS Nexus · plan de cuentas propuesto para servicios petroleros en Venezuela
--
-- Es una PROPUESTA, no una imposicion. Si GPS tiene ya su plan, se carga el suyo y
-- esto no se usa: nada del sistema depende de estos codigos concretos, porque las
-- cuentas se referencian por concepto a traves de mapa_cuenta.
--
-- Lo que si esta pensado a proposito:
--   - Los ingresos se separan por tipo de servicio, porque saber cual de los cinco
--     deja dinero es media decision de negocio.
--   - El costo se separa en material, personal de campo, subcontratos, transporte,
--     equipos y aduana: son las seis formas en que se va el dinero de un contrato.
--   - El diferencial cambiario tiene cuenta propia a cada lado. En Venezuela, si se
--     diluye dentro de otro gasto, deja de verse lo que cuesta de verdad.
--   - Retencion de garantia por cobrar va aparte de clientes: es dinero ya ganado
--     que no se puede cobrar todavia, y confundirlo con una cuenta por cobrar normal
--     hace que la antiguedad de saldos mienta.

create or replace function instalar_plan_cuentas(p_org uuid)
returns int
language plpgsql as $$
declare n int;
begin
  insert into cuenta (organizacion_id, codigo, nombre_es, nombre_en, naturaleza, padre, imputable)
  select p_org, c.codigo, c.es, c.en, c.nat::naturaleza_cuenta, c.padre, c.imp
    from (values
    -- ACTIVO -----------------------------------------------------------------
    ('1',          'Activo',                              'Assets',                          'activo', null,   false),
    ('1.1',        'Activo circulante',                   'Current assets',                  'activo','1',     false),
    ('1.1.01',     'Caja y bancos',                       'Cash and banks',                  'activo','1.1',   false),
    ('1.1.01.01',  'Caja chica',                          'Petty cash',                      'activo','1.1.01',true),
    ('1.1.01.02',  'Bancos en bolívares',                 'Banks in bolivars',               'activo','1.1.01',true),
    ('1.1.01.03',  'Bancos en divisas',                   'Banks in foreign currency',       'activo','1.1.01',true),
    ('1.1.02',     'Cuentas por cobrar',                  'Accounts receivable',             'activo','1.1',   false),
    ('1.1.02.01',  'Clientes nacionales',                 'Domestic customers',              'activo','1.1.02',true),
    ('1.1.02.02',  'Clientes del exterior',               'Foreign customers',               'activo','1.1.02',true),
    ('1.1.02.03',  'Retención de garantía por cobrar',    'Retention receivable',            'activo','1.1.02',true),
    ('1.1.02.04',  'Provisión de cobro dudoso',           'Allowance for doubtful accounts', 'activo','1.1.02',true),
    ('1.1.03',     'Anticipos a proveedores',             'Advances to suppliers',           'activo','1.1',   true),
    ('1.1.04',     'Impuestos por recuperar',             'Recoverable taxes',               'activo','1.1',   false),
    ('1.1.04.01',  'IVA crédito fiscal',                  'Input VAT',                       'activo','1.1.04',true),
    ('1.1.04.02',  'IVA retenido por clientes',           'VAT withheld by customers',       'activo','1.1.04',true),
    ('1.1.04.03',  'ISLR retenido por clientes',          'Income tax withheld by customers','activo','1.1.04',true),
    ('1.1.04.04',  'ISLR estimado pagado',                'Estimated income tax paid',       'activo','1.1.04',true),
    ('1.1.05',     'Inventarios',                         'Inventory',                       'activo','1.1',   false),
    ('1.1.05.01',  'Materiales y repuestos',              'Materials and spares',            'activo','1.1.05',true),
    ('1.1.05.02',  'Mercancía en tránsito',               'Goods in transit',                'activo','1.1.05',true),
    ('1.1.05.03',  'Mercancía en aduana',                 'Goods in customs',                'activo','1.1.05',true),
    ('1.1.06',     'Gastos pagados por anticipado',       'Prepaid expenses',                'activo','1.1',   true),
    ('1.2',        'Activo no circulante',                'Non-current assets',              'activo','1',     false),
    ('1.2.01',     'Propiedad, planta y equipo',          'Property, plant and equipment',   'activo','1.2',   false),
    ('1.2.01.01',  'Terrenos',                            'Land',                            'activo','1.2.01',true),
    ('1.2.01.02',  'Edificaciones',                       'Buildings',                       'activo','1.2.01',true),
    ('1.2.01.03',  'Maquinaria y equipos',                'Machinery and equipment',         'activo','1.2.01',true),
    ('1.2.01.04',  'Equipos para alquiler',               'Rental equipment',                'activo','1.2.01',true),
    ('1.2.01.05',  'Vehículos',                           'Vehicles',                        'activo','1.2.01',true),
    ('1.2.01.06',  'Mobiliario y equipos de oficina',     'Furniture and office equipment',  'activo','1.2.01',true),
    ('1.2.02',     'Depreciación acumulada',              'Accumulated depreciation',        'activo','1.2',   true),
    -- PASIVO -----------------------------------------------------------------
    ('2',          'Pasivo',                              'Liabilities',                     'pasivo', null,   false),
    ('2.1',        'Pasivo circulante',                   'Current liabilities',             'pasivo','2',     false),
    ('2.1.01',     'Cuentas por pagar',                   'Accounts payable',                'pasivo','2.1',   false),
    ('2.1.01.01',  'Proveedores nacionales',              'Domestic suppliers',              'pasivo','2.1.01',true),
    ('2.1.01.02',  'Proveedores del exterior',            'Foreign suppliers',               'pasivo','2.1.01',true),
    ('2.1.02',     'Anticipos recibidos de clientes',     'Customer advances received',      'pasivo','2.1',   true),
    ('2.1.03',     'Impuestos por pagar',                 'Taxes payable',                   'pasivo','2.1',   false),
    ('2.1.03.01',  'IVA débito fiscal',                   'Output VAT',                      'pasivo','2.1.03',true),
    ('2.1.03.02',  'IVA retenido a proveedores',          'VAT withheld from suppliers',     'pasivo','2.1.03',true),
    ('2.1.03.03',  'ISLR retenido a terceros',            'Income tax withheld from third parties','pasivo','2.1.03',true),
    ('2.1.03.04',  'ISLR por pagar',                      'Income tax payable',              'pasivo','2.1.03',true),
    ('2.1.03.05',  'Impuestos municipales por pagar',     'Municipal taxes payable',         'pasivo','2.1.03',true),
    ('2.1.04',     'Obligaciones laborales',              'Employee obligations',            'pasivo','2.1',   false),
    ('2.1.04.01',  'Sueldos y salarios por pagar',        'Wages and salaries payable',      'pasivo','2.1.04',true),
    ('2.1.04.02',  'Prestaciones sociales',               'Severance benefits',              'pasivo','2.1.04',true),
    ('2.1.04.03',  'Vacaciones y utilidades',             'Vacation and profit sharing',     'pasivo','2.1.04',true),
    ('2.1.04.04',  'Aportes patronales',                  'Employer contributions',          'pasivo','2.1.04',true),
    ('2.1.05',     'Préstamos a corto plazo',             'Short-term loans',                'pasivo','2.1',   true),
    ('2.2',        'Pasivo no circulante',                'Non-current liabilities',         'pasivo','2',     true),
    -- PATRIMONIO -------------------------------------------------------------
    ('3',          'Patrimonio',                          'Equity',                          'patrimonio', null, false),
    ('3.1.01',     'Capital social',                      'Share capital',                   'patrimonio','3',  true),
    ('3.1.02',     'Reserva legal',                       'Legal reserve',                   'patrimonio','3',  true),
    ('3.1.03',     'Resultados acumulados',               'Retained earnings',               'patrimonio','3',  true),
    ('3.1.04',     'Resultado del ejercicio',             'Result for the period',           'patrimonio','3',  true),
    ('3.1.05',     'Actualización por inflación',         'Inflation restatement',           'patrimonio','3',  true),
    -- INGRESOS ---------------------------------------------------------------
    ('4',          'Ingresos',                            'Revenue',                         'ingreso', null,   false),
    ('4.1',        'Ingresos por contratos',              'Contract revenue',                'ingreso','4',     false),
    ('4.1.01',     'Procura',                             'Procurement',                     'ingreso','4.1',   true),
    ('4.1.02',     'Servicios',                           'Services',                        'ingreso','4.1',   true),
    ('4.1.03',     'Reacondicionamiento de pozos',        'Well workover',                   'ingreso','4.1',   true),
    ('4.1.04',     'Transporte',                          'Transport',                       'ingreso','4.1',   true),
    ('4.1.05',     'Alquiler de equipos',                 'Equipment rental',                'ingreso','4.1',   true),
    ('4.2',        'Otros ingresos',                      'Other income',                    'ingreso','4',     false),
    ('4.2.01',     'Ingresos financieros',                'Financial income',                'ingreso','4.2',   true),
    ('4.2.02',     'Diferencial cambiario ganado',        'FX gain',                         'ingreso','4.2',   true),
    -- COSTOS Y GASTOS --------------------------------------------------------
    ('5',          'Costos y gastos',                     'Costs and expenses',              'gasto', null,     false),
    ('5.1',        'Costo de ventas',                     'Cost of sales',                   'gasto','5',       false),
    ('5.1.01',     'Material y equipos',                  'Materials and equipment',         'gasto','5.1',     true),
    ('5.1.02',     'Personal de campo',                   'Field personnel',                 'gasto','5.1',     true),
    ('5.1.03',     'Subcontratos',                        'Subcontracts',                    'gasto','5.1',     true),
    ('5.1.04',     'Transporte y fletes',                 'Transport and freight',           'gasto','5.1',     true),
    ('5.1.05',     'Equipos y alquileres',                'Equipment and rentals',           'gasto','5.1',     true),
    ('5.1.06',     'Aduana y nacionalización',            'Customs and clearance',           'gasto','5.1',     true),
    ('5.2',        'Gastos operativos',                   'Operating expenses',              'gasto','5',       false),
    ('5.2.01',     'Sueldos y salarios',                  'Wages and salaries',              'gasto','5.2',     true),
    ('5.2.02',     'Honorarios profesionales',            'Professional fees',               'gasto','5.2',     true),
    ('5.2.03',     'Alquileres',                          'Rent',                            'gasto','5.2',     true),
    ('5.2.04',     'Servicios básicos',                   'Utilities',                       'gasto','5.2',     true),
    ('5.2.05',     'Depreciación',                        'Depreciation',                    'gasto','5.2',     true),
    ('5.2.06',     'Seguros',                             'Insurance',                       'gasto','5.2',     true),
    ('5.2.07',     'Impuestos municipales',               'Municipal taxes',                 'gasto','5.2',     true),
    ('5.2.08',     'Gastos bancarios',                    'Bank charges',                    'gasto','5.2',     true),
    ('5.2.09',     'IGTF',                                'FX transaction tax',              'gasto','5.2',     true),
    ('5.2.10',     'Diferencial cambiario perdido',       'FX loss',                         'gasto','5.2',     true),
    ('5.2.11',     'Provisión de cobro dudoso',           'Doubtful accounts expense',       'gasto','5.2',     true)
    ) as c(codigo, es, en, nat, padre, imp)
  on conflict do nothing;

  get diagnostics n = row_count;

  -- Los conceptos que usan los generadores, apuntando a este plan.
  insert into mapa_cuenta (organizacion_id, concepto, cuenta) values
    (p_org,'banco',             '1.1.01.02'),
    (p_org,'caja_chica',        '1.1.01.01'),
    (p_org,'cxc',               '1.1.02.01'),
    (p_org,'garantia_retenida', '1.1.02.03'),
    (p_org,'iva_credito',       '1.1.04.01'),
    (p_org,'ret_iva_sufrida',   '1.1.04.02'),
    (p_org,'ret_islr_sufrida',  '1.1.04.03'),
    (p_org,'cxp',               '2.1.01.01'),
    (p_org,'anticipo_recibido', '2.1.02'),
    (p_org,'iva_debito',        '2.1.03.01'),
    (p_org,'ret_iva_hecha',     '2.1.03.02'),
    (p_org,'ret_islr_hecha',    '2.1.03.03'),
    (p_org,'ingreso_obra',      '4.1.02'),
    (p_org,'fx_ganado',         '4.2.02'),
    (p_org,'gasto',             '5.2.01'),
    (p_org,'igtf_gasto',        '5.2.09'),
    (p_org,'fx_perdido',        '5.2.10')
  on conflict do nothing;

  return n;
end $$;

-- El ingreso de un contrato va a la cuenta de su tipo de servicio, no a una sola
-- cuenta de "ingresos". Saber cual de los cinco deja dinero es media decision.
create or replace function cuenta_ingreso_de(p_org uuid, p_tipo tipo_contrato) returns text
language sql stable as $$
  select case p_tipo
           when 'procura'             then '4.1.01'
           when 'servicio'            then '4.1.02'
           when 'reacondicionamiento' then '4.1.03'
           when 'transporte'          then '4.1.04'
           when 'alquiler'            then '4.1.05'
         end
$$;
