$ErrorActionPreference='Stop'
$base='http://localhost:5000/api'
$rand=Get-Random
$pass='Password123!'
$adminEmail="admin_att_$rand@example.com"

$reg=Invoke-RestMethod -Uri "$base/auth/register" -Method Post -TimeoutSec 10 -ContentType 'application/json' -Body (@{email=$adminEmail;password=$pass;name='Admin Attach'}|ConvertTo-Json)
$token=$reg.data.token

$null=Invoke-RestMethod -Uri "$base/companies" -Method Post -TimeoutSec 10 -ContentType 'application/json' -Headers @{Authorization="Bearer $token"} -Body (@{name="Att Co $rand";industry='IT';size='11-50'}|ConvertTo-Json)

$login=Invoke-RestMethod -Uri "$base/auth/login" -Method Post -TimeoutSec 10 -ContentType 'application/json' -Body (@{email=$adminEmail;password=$pass}|ConvertTo-Json)
$token2=$login.data.token

$ch=Invoke-RestMethod -Uri "$base/channels" -Method Post -TimeoutSec 10 -ContentType 'application/json' -Headers @{Authorization="Bearer $token2"} -Body (@{name="att-$rand";description='attach test';type='private';memberIds=@()}|ConvertTo-Json)
$channelId=$ch.data._id

$msg=Invoke-RestMethod -Uri "$base/messages" -Method Post -TimeoutSec 10 -ContentType 'application/json' -Headers @{Authorization="Bearer $token2"} -Body (@{channelId=$channelId;content='';attachments=@(@{url='https://example.com/a.png';name='a.png';type='image/png';size=123;resourceType='image'})}|ConvertTo-Json -Depth 6)

@{success=$msg.success;messageId=$msg.data._id;type=$msg.data.type;content=$msg.data.content;attachmentsCount=($msg.data.attachments|Measure-Object).Count} | ConvertTo-Json -Compress
