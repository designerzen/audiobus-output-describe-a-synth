$ErrorActionPreference = 'Stop'
$revision = '8f9544df5933b9ed4a7e8ed7fa6f77b3dd48ddce'
$baseUrl = "https://huggingface.co/atauser001/stable-audio-open-small-onnx/resolve/$revision"
$expected = @{
    'cond.onnx' = '847822809975d0c36a665594fad0312c4c225147910657820e9936b09014629c'
    'dit.onnx' = '8e9c8b14baac4a26159d5ecf3d365ef5a097f321541f9548d62d136354a23d8b'
    'dec.onnx' = '96029859b4d563f3aff266e97e715190e8d53278c6e27ab94095535a0da4c911'
    'tokenizer.json' = 'd2acde0d8d71dd30a711834b07781b9c89feaac33fd332f60507699282740066'
}
foreach ($name in $expected.Keys) {
    $destination = Join-Path $PSScriptRoot $name
    if ((Test-Path -LiteralPath $destination) -and
        (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -eq $expected[$name]) {
        Write-Output "Verified $name"
        continue
    }
    $partial = "$destination.partial"
    for ($attempt = 0; $attempt -lt 4; $attempt++) {
        & curl.exe --fail --location --show-error --max-time 600 --continue-at - --output $partial "$baseUrl/$name"
        if ($LASTEXITCODE -eq 0) { break }
    }
    if (!(Test-Path -LiteralPath $partial) -or
        (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ne $expected[$name]) {
        throw "Incomplete or invalid $name; run again to resume the download."
    }
    Move-Item -LiteralPath $partial -Destination $destination -Force
    Write-Output "Verified $name"
}
foreach ($notice in @('LICENSE', 'NOTICE')) {
    & curl.exe --fail --location --show-error --output (Join-Path $PSScriptRoot "MODEL-$notice") "$baseUrl/$notice"
    if ($LASTEXITCODE -ne 0) { throw "Unable to download model $notice" }
}
