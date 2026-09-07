export type ClockUnit = 'round' | 'rounds' | 'minute' | 'minutes' | 'hour' | 'hours' | 'day' | 'days';

export const ROUNDS_PER_MINUTE = 10;
export const ROUNDS_PER_HOUR = ROUNDS_PER_MINUTE * 60;
export const ROUNDS_PER_DAY = ROUNDS_PER_HOUR * 24;

export function durationToRounds(amount: number, unit: ClockUnit): number {
    switch (unit) {
        case 'round':
        case 'rounds':
            return amount;
        case 'minute':
        case 'minutes':
            return amount * ROUNDS_PER_MINUTE;
        case 'hour':
        case 'hours':
            return amount * ROUNDS_PER_HOUR;
        case 'day':
        case 'days':
            return amount * ROUNDS_PER_DAY;
    }
}

export type FormattedClock = {
    totalRounds: number;
    days: number;
    hours: number;
    minutes: number;
    rounds: number;
};

export function formatClock(totalRounds: number): FormattedClock {
    const days = Math.floor(totalRounds / ROUNDS_PER_DAY);
    let remainder = totalRounds - days * ROUNDS_PER_DAY;
    const hours = Math.floor(remainder / ROUNDS_PER_HOUR);
    remainder -= hours * ROUNDS_PER_HOUR;
    const minutes = Math.floor(remainder / ROUNDS_PER_MINUTE);
    const rounds = remainder - minutes * ROUNDS_PER_MINUTE;
    return { totalRounds, days, hours, minutes, rounds };
}
