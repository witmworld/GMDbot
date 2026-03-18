import { getClubMember } from '../integrations/fillout.js'

export async function isAdmin(userId) {
  try {
    const member = await getClubMember(userId)
    return member && member['Админ'] === true
  } catch (err) {
    console.error('[Admin Check] Error:', err)
    return false
  }
}
