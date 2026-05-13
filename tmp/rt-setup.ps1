$ErrorActionPreference='Stop'
$base='http://localhost:5000/api'
$rand=Get-Random
$pass='Password123!'
$adminEmail="admin_rt_$rand@example.com"
$employeeEmail="employee_rt_$rand@example.com"

$adminReg=Invoke-RestMethod -Uri "$base/auth/register" -Method Post -TimeoutSec 10 -ContentType 'application/json' -Body (@{email=$adminEmail;password=$pass;name='Admin RT'}|ConvertTo-Json)
$adminId=$adminReg.data.user._id
$adminToken=$adminReg.data.token

$null=Invoke-RestMethod -Uri "$base/companies" -Method Post -TimeoutSec 10 -ContentType 'application/json' -Headers @{Authorization="Bearer $adminToken"} -Body (@{name="RT Co $rand";industry='IT';size='11-50'}|ConvertTo-Json)

$adminLogin=Invoke-RestMethod -Uri "$base/auth/login" -Method Post -TimeoutSec 10 -ContentType 'application/json' -Body (@{email=$adminEmail;password=$pass}|ConvertTo-Json)
$adminToken2=$adminLogin.data.token

$invite=Invoke-RestMethod -Uri "$base/companies/my/invite-code" -Method Get -TimeoutSec 10 -Headers @{Authorization="Bearer $adminToken2"}
$inviteCode=$invite.data.inviteCode

$empReg=Invoke-RestMethod -Uri "$base/auth/register" -Method Post -TimeoutSec 10 -ContentType 'application/json' -Body (@{email=$employeeEmail;password=$pass;name='Employee RT';inviteCode=$inviteCode}|ConvertTo-Json)
$employeeId=$empReg.data.user._id

$empLogin=Invoke-RestMethod -Uri "$base/auth/login" -Method Post -TimeoutSec 10 -ContentType 'application/json' -Body (@{email=$employeeEmail;password=$pass}|ConvertTo-Json)
$empToken=$empLogin.data.token

$channel=Invoke-RestMethod -Uri "$base/channels" -Method Post -TimeoutSec 10 -ContentType 'application/json' -Headers @{Authorization="Bearer $adminToken2"} -Body (@{name="rt-$rand";description='realtime test';type='private';memberIds=@($employeeId)}|ConvertTo-Json)
$channelId=$channel.data._id

@{
  rand=$rand
  adminEmail=$adminEmail
  employeeEmail=$employeeEmail
  adminId=$adminId
  employeeId=$employeeId
  channelId=$channelId
  adminToken=$adminToken2
  empToken=$empToken
} | ConvertTo-Json -Compress
