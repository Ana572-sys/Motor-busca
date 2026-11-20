# Radar G&I — base de aplicação

Aplicação interna em desenvolvimento. Existe um piloto em https://radar-gi.vercel.app; **não é um MVP concluído nem está pronta para produção**.

## Estado

- Interface Next.js com páginas de entrada, recuperação de palavra-passe, dashboard e separadores.
- As quatro contas foram criadas e associadas aos perfis; o acesso da administradora foi testado. Falta testar as restantes três contas.
- PostgreSQL com RLS e 49 nomes de fontes. As fontes com conectores são ativadas progressivamente; consultar o estado individual na aplicação.
- Gestão de fontes por administrador com auditoria, convites restritos aos quatro endereços previstos e consulta de avisos, versões e alterações que estejam registados. Os convites dependem de configurar Supabase Auth e SMTP e não foram testados com uma conta real.
- Regras de domínio testadas para apresentação conservadora, comparação de campos, prorrogações, reutilização de fichas e fuso horário. Ainda não existe um processo que alimente estas regras.
- Geração de fichas preparada para um endpoint compatível com a API de chat, apenas por ação do utilizador e quando os materiais da versão estiverem marcados como completos. Verifica as secções, a dimensão da introdução e se as citações constam literalmente dos documentos; não garante que a interpretação seja correta. A recolha e validação integral dos materiais ainda não estão implementadas, pelo que não existe geração funcional ponta a ponta.
- Inventário de ZIP com limites de tamanho e entradas, que identifica PDF, Office, ZIP aninhado e outros tipos sem os executar. Não substitui análise antimalware nem extrai ou valida os documentos.
- Consulta experimental manual da listagem da Portugal Inovação Social: guarda as respostas com hash e regista candidatos e versões dos campos expressos. No teste do piloto publicado foram guardados 30 registos. A estrutura pode mudar e o conector recusa resultados se não conseguir confirmar a estrutura e a paginação esperadas. Os candidatos **não são avisos elegíveis**: os documentos, o estado e a elegibilidade não são verificados. O hash da página HTML pode incluir dados variáveis e não indica alteração de aviso.
- Adaptador experimental do Pessoas 2030 com paginação e validação de cache; no teste do piloto publicado foram guardados 7 registos indicados como abertos pela fonte. Não valida a elegibilidade nem analisa os documentos.
- Adaptador experimental para o serviço geral de avisos do Portugal 2030: numa consulta real, foram guardados 272 candidatos. Podem existir duplicados entre fontes; elegibilidade e documentos não foram verificados. Não consultar o Plano Anual de Avisos.
- O botão de pesquisa manual está ligado ao processador das três fontes anteriores e do COMPETE 2030. O conector COMPETE percorre a listagem oficial, guarda apenas os registos identificados como abertos e recusa paginação repetida ou alterada; os documentos e a elegibilidade não são verificados.
- O Funding & Tenders Portal foi ligado e testado com 385 candidatos; o filtro recolhe tópicos de subvenção, não contratação pública. Uma repetição idêntica na mesma página é consolidada e repetições inconsistentes ou entre páginas fazem falhar a consulta. O estado real, os documentos e a participação portuguesa continuam por verificar. O PRR usa o serviço público de pesquisa de avisos abertos, com a tipologia de candidatura e sem contratação pública. A ligação ao PRR foi testada na versão publicada com a cadeia de certificados validada.
- Foram ligadas e testadas as listagens da FCT, do Fundo Ambiental, Interreg, EIT, DGARTES, PEPAC e IEFP. A listagem do PEPAC inclui concursos que podem estar encerrados; as medidas do IEFP sem indicação expressa de estado também são guardadas por validar. No Fundo Ambiental foi observada uma data de encerramento passada numa entrada da secção de abertos. A cobertura Interreg restringe-se às chamadas que indicam Portugal. Os registos são candidatos preliminares, não avisos elegíveis.
- O envio de alertas de falha das fontes-piloto está preparado com fila e controlo para evitar reenvios automáticos quando o resultado é ambíguo. A migração `0015` foi aplicada, mas faltam a configuração do Microsoft Graph e os testes reais; sem estes passos não envia mensagens. O resumo semanal não está ligado ao agendamento. Uma resposta 202 do Graph confirma aceitação do pedido, não entrega.
- Não implementados: pesquisa completa em todas as fontes, criação de versões de avisos validados, recolha e análise integral de documentos, geração de fichas ponta a ponta, agendamento efetivo, ligação operacional ao Graph, filtros completos e testes de segurança. Os botões que dependeriam desses serviços não simulam resultados.
- A migração é inicial: é necessário rever permissões, retenção e políticas de acesso antes de produção. Os dados indicados como exemplo não são oportunidades reais.

## Execução local

1. Instalar dependências com `npm install`.
2. Criar um projeto Supabase, aplicar por ordem todos os ficheiros em `supabase/migrations` e configurar as políticas de autenticação e SMTP da organização.
3. Copiar `.env.example` para `.env.local` e preencher `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL` e, para os convites, `SUPABASE_SECRET_KEY`. Não guardar segredos no repositório.
4. Desativar o registo público no Supabase Auth. Criar contas individualmente por convite e inserir os respetivos IDs e endereços em `public.users` através de um administrador. A conta sem perfil não obtém acesso aos dados.
5. Executar `npm run dev` e aceder ao endereço local indicado. Configurar no Supabase os URLs de redirecionamento permitidos para recuperação.

O esquema `0001` a `0030` foi aplicado ao projeto «Motor de Busca GI EU» através do editor SQL, em vez do mecanismo de histórico de migrações da CLI. A existência de 17 tabelas com RLS e 49 fontes foi confirmada no projeto. O acesso da administradora e as consultas experimentais foram testados no piloto publicado. Não executar `supabase db push` sobre esse projeto sem antes reconciliar o histórico de migrações, para não tentar recriar tabelas existentes.

As funções da versão atual da Vercel estão configuradas para Dublin (`dub1`). Os primeiros testes da versão anterior foram executados na região predefinida da Vercel nos EUA. O registo público no Supabase Auth está desativado. Os convites e a recuperação de palavra-passe necessitam de configuração e teste de um serviço SMTP autorizado; o envio predefinido do Supabase tem restrições e não está preparado para convidar as restantes pessoas.

A fila e o processador experimental foram ligados ao botão manual e testados com várias fontes no piloto publicado; não existe agendamento. O endpoint autónomo do processador exige `SCAN_WORKER_SECRET`, com pelo menos 32 caracteres, mantido apenas nas variáveis de ambiente do servidor. A pesquisa manual usa o processamento na própria ação e `SCAN_WORKER_READY=true`. Uma pesquisa guarda resultados preliminares e fica marcada como parcial; o período escolhido ainda não filtra os resultados. Não ativar o agendamento enquanto a configuração e os testes reais não estiverem concluídos.

## Destinatários previstos

ana.oliveira@crowe.pt, sara.fernandes@crowe.pt, raquel.lusquinos@crowe.pt e nuno.vieira@crowe.pt. Estes endereços são destinatários previstos, não configuram uma caixa remetente nem concedem permissões Microsoft Graph.

## Decisões por concluir

Validar URLs e método de recolha de cada fonte; definir infraestrutura de processamento retomável, OCR e análise de ficheiros; implementar deduplicação, evidência por campo, classificação conservadora e tratamento de erros; configurar planos, região, backups, SMTP, fornecedor de IA, Graph e calendário Europe/Lisbon. Verificar permissões e testes ponta a ponta antes da entrada em produção.
