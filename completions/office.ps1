# PowerShell tab completion for 5CR1PT3R5 (Windows PowerShell 5.1 and PowerShell 7).
# Dot-sourced from your $PROFILE by scripts/install.ps1.

Register-ArgumentCompleter -Native -CommandName office -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)

    $commands = [ordered]@{
        roster   = 'Who works here and what they are doing'
        assign   = 'Give one agent a job'
        delegate = 'Let the Tech Lead split a big request across the team'
        ui       = 'Pixel-art office in your browser'
        board    = 'Live view of the whole office'
        status   = 'Job list, or the full card for one job'
        logs     = 'What an agent did, step by step'
        reply    = 'Follow up with an agent on a finished job'
        cancel   = 'Stop a queued or running job'
        doctor   = 'Check that Claude Code and the shells are set up'
        help     = 'Show usage'
    }

    function New-Completion([string]$Text, [string]$Tooltip, [string]$Type = 'ParameterValue') {
        [System.Management.Automation.CompletionResult]::new($Text, $Text, $Type, $Tooltip)
    }

    # Parse `id:description` lines printed by `office __complete <what>`.
    function Get-OfficeList([string]$What) {
        office __complete $What 2>$null | ForEach-Object {
            $id, $description = $_ -split ':', 2
            [pscustomobject]@{ Id = $id; Description = $description }
        }
    }

    $elements = @($commandAst.CommandElements | ForEach-Object { $_.ToString() })
    # Index of the argument being completed (elements[0] is `office` itself).
    $position = if ($wordToComplete) { $elements.Count - 1 } else { $elements.Count }
    $command = if ($elements.Count -gt 1) { $elements[1] } else { '' }

    if ($position -eq 1) {
        $commands.Keys | Where-Object { $_ -like "$wordToComplete*" } |
            ForEach-Object { New-Completion $_ $commands[$_] 'Command' }
        return
    }

    $previous = $elements[$position - 1]
    if ($previous -in '-m', '--model') {
        'haiku', 'sonnet', 'opus' | Where-Object { $_ -like "$wordToComplete*" } |
            ForEach-Object { New-Completion $_ "Run on $_" }
        return
    }

    if ($wordToComplete -like '-*') {
        $flags = switch ($command) {
            { $_ -in 'assign', 'delegate' } { '--project', '--model', '--budget', '--after' }
            'status' { '--all', '--json' }
            'logs'   { '--follow' }
            'reply'  { '--model', '--budget' }
            'ui'     { '--port', '--no-open' }
        }
        $flags | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { New-Completion $_ $_ 'ParameterName' }
        return
    }

    if ($position -eq 2 -and $command -eq 'assign') {
        Get-OfficeList agents | Where-Object { $_.Id -like "$wordToComplete*" } |
            ForEach-Object { New-Completion $_.Id $_.Description }
        return
    }

    if ($position -eq 2 -and $command -in 'status', 'logs', 'reply', 'cancel') {
        Get-OfficeList jobs | Where-Object { $_.Id -like "$wordToComplete*" } |
            ForEach-Object { New-Completion $_.Id $_.Description }
    }
}
