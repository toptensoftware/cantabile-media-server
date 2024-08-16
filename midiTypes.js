export class MidiMessage
{
    static NoteOff = 0x80;	// b2=note, b3=velocity
    static NoteOn = 0x90;	// b2=note, b3=velocity
    static AfterTouch = 0xA0;	// b2=note, b3=pressure
    static ControlChange = 0xB0;	// b2=controller, b3=value
    static ProgramChange = 0xC0;	// b2=program number
    static ChannelPressure = 0xD0;	// b2=pressure
    static PitchBend = 0xE0;	// pitch (b3 & 0x7f) << 7 | (b2 & 0x7f) and center=0x2000
    static Sysex = 0xF0;
    static SysexCont = 0xF7;
    static Meta = 0xFF;
    static ActiveSense = 0xFE;
    static MtcQuarterFrame = 0xF1;		
    static SongPosition = 0xF2;
    static SongSelect = 0xF3;
    static TuneRequest = 0xF6;
    static Clock = 0xF8;
    static Tick = 0xF9; 
    static Start = 0xFA; 
    static Continue	= 0xFB;
    static Stop	= 0xFC; 
    static Reset= 0xFF; 
}

export class MidiController
{
    static BankSelectMsb = 0;
    static DataEntryMsb = 6;
    static Volume = 7;
    static BankSelectLsb = 32;
    static DataEntryLsb = 38;
    static Dample = 64;
    static Portamento = 65;
    static Sostenuto = 66;
    static SoftPedal = 67;
    static NrpnLsb = 98;
    static NrpnMsb = 99;
    static RpnLsb = 100;
    static RpnMsb = 101;
    static AllSoundOff = 120;
    static ResetAllControllers = 121;
    static LocalControl = 122;
    static AllNotesOff = 123;
    static OmniModeOff = 124;
    static OnmiModeOn = 125;
    static PolyMode = 126;
    static PolyModeOn = 127;
}

export class MidiMmc
{
    static Stop = 0x1;
    static Play = 0x2;
    static DeferredPlay = 0x3;
    static FastForward = 0x4;
    static Rewind = 0x5;
    static RecordPunchIn = 0x6;
    static RecordPunchOut = 0x7;
    static RecordReady = 0x8;
    static Pause = 0x9;
    static Eject = 0xA;
    static Chase = 0xB;
    static Reset = 0xF;
}