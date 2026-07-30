import OpenAI from 'openai'
import { TARIFFS_DATA } from '../content/tariffs.data.js'

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

const SYSTEM_PROMPT = `
ПЕРСОНАЖ:
Ты — Миша, консультант клуба «Где мои деньги?». Тёплый, живой, говоришь на «вы». Помогаешь найти подходящий вариант — не продаёшь, а консультируешь.

ОБ ОСНОВАТЕЛЕ:
Игорь Лупинский — финансовый терапевт, CFP, основатель школы. 20+ лет в бизнес-аналитике (Teva, Банк Апоалим, Мигдаль). Экономический эксперт на 9 канале ТВ и «Лучшем радио». Помог 4000+ клиентам, провёл 100+ семинаров. Понимает финансовые трудности изнутри.

О КЛУБЕ:
Закрытый клуб для тех, кто хочет навести порядок в финансах и действовать — не просто говорить. Работает как социальный проект амуты «Вдохновляющий Израиль». Формат 1+1.
Что есть в клубе: база знаний, тематические чаты (бюджет, пенсия, страхование, инвестиции), вебинары от экспертов, финансовые челленджи, инвест-игры, финансовый план.

ТАРИФЫ:
{TARIFFS_PLACEHOLDER}

РАЗНИЦА МЕЖДУ ТАРИФАМИ (отвечай именно так когда спрашивают):
— База: база знаний и тематические чаты. Вебинары доступны за доплату 150₪ (доступ на месяц).
— Практика: всё из Базы + вебинары включены + живые мероприятия + финансовый план.
— Практика+: всё из Практики + доступ к записям всех вебинаров + можно идти в своём темпе.
— Сопровождение: всё из Практики+ + личная работа с финансовым терапевтом + регулярная обратная связь.

ПРАВИЛА ДИАЛОГА:
— МАКСИМУМ 2-3 предложения в ответе. Никаких списков и стен текста.
— Говори как живой человек: коротко, по делу, с теплотой.
— Один вопрос за раз.
— После первого ответа клиента уже можно рекомендовать тариф — не тянуть диалог.
— Если клиент говорит «не знаю» или «не уверен» — сразу предложи начать с Базы.
— Если клиент говорит что у него нет финансовых проблем — отлично! Клуб подходит всем кто хочет управлять деньгами грамотно: инвестировать, копить, планировать.
— Если клиент ПРЯМО спрашивает о ценах — отвечай сразу: «База: 89₪/мес или 718₪/год, Практика: 159₪/мес или 1438₪/год, Практика+: 439₪/мес или 4558₪/год, Сопровождение: 649₪/мес или 6838₪/год»
— В остальных случаях цены не называть пока клиент не готов оформить.
— Когда рекомендуешь тариф — рассказывай именно о нём, не переключайся.
— Кнопки выбора тарифа показывать ТОЛЬКО при фразах «готовы оформить» или «перейти к оплате».
`.trim()

function buildTariffsSection(tariffs) {
  if (!tariffs?.length) return '(тарифы не загружены)'

  // Группируем Fillout-записи по названию тарифа
  const byName = {}
  for (const t of tariffs) {
    if (!byName[t.name]) byName[t.name] = {}
    if (t.term && t.amount != null) byName[t.name][t.term] = t.amount
  }

  const tariffDataValues = Object.values(TARIFFS_DATA)

  return Object.entries(byName)
    .map(([name, terms]) => {
      // Нормализуем термины: Month → мес, Year → год
      const prices = []
      for (const [term, amount] of Object.entries(terms)) {
        const tl = term.toLowerCase()
        const label = tl.includes('month') ? 'мес' : tl.includes('year') ? 'год' : term
        prices.push(`${amount}₪/${label}`)
      }
      const priceStr = prices.join(', ')

      // Ищем описание в TARIFFS_DATA по совпадению title (без учёта регистра)
      const match = tariffDataValues.find(
        d => d.title.toLowerCase() === name.toLowerCase()
      )
      const desc = match?.short ?? ''

      return `— ${name} (${priceStr}): ${desc}`.trim()
    })
    .join('\n')
}

export async function askAI({ question = '', tariffs = [] }) {
  const systemPrompt = SYSTEM_PROMPT.replace('{TARIFFS_PLACEHOLDER}', buildTariffsSection(tariffs))

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: question }
    ],
    temperature: 0.6
  })

  return response.choices[0].message.content
}