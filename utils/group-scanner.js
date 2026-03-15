import { writeFileSync } from 'fs'

/**
 * Scans a Telegram group and returns its administrators.
 * NOTE: Telegram Bot API does not allow fetching all group members —
 * only administrators are accessible via getChatAdministrators.
 * getChatMembersCount returns the total count for reference.
 */
export async function scanGroupMembers(ctx, groupId) {
  const [admins, totalCount] = await Promise.all([
    ctx.telegram.getChatAdministrators(groupId),
    ctx.telegram.getChatMembersCount(groupId),
  ])

  const members = admins.map(({ user }) => ({
    user_id:    user.id,
    username:   user.username   || null,
    first_name: user.first_name || null,
    last_name:  user.last_name  || null,
  }))

  console.log('Found admins:', members.map(a =>
    `${a.first_name} ${a.last_name} (@${a.username || 'no username'}) ID: ${a.user_id}`
  ))

  const result = {
    groupId,
    totalCount,
    scannedAt: new Date().toISOString(),
    members,
  }

  writeFileSync('/tmp/group_members.json', JSON.stringify(result, null, 2))

  return result
}
