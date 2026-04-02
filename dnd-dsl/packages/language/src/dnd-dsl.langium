grammar DndDsl

entry Model:
    (World=World);

World:
    'world' name=STRING
    ((locations+=Location)+
    | (functions+=FunctionDeclaration)+
    | (quests+=Quest)+
    | (events+=Event)+)*;

//Location
Location:
    'location' name=STRING
    (entry=LocationEntry)?
    (exits+=LocationExit)*
    (variables+=VariableDeclaration)*
    (Description)?
    ('sublocations' sublocations+=Location* 'end')?;
LocationExit:
    'exit' name=STRING 'to' exit=LocationChain identifiers+=Identifier*;
LocationEntry:
    'entry' entry=LocationChain;
LocationChain:
    locations+=[Location:STRING] ('->' locations+=[Location:STRING])*;
Identifier:
    '['tag=STRING ((':'|'=') value=ConstantExpression)? ']';

//Quest
Quest:
    'quest' name=STRING
    (Description)?
    (CompleteableEvents)?
    (objectives+=Objective)+;
Objective:
    'objective' name=STRING
    (Description)?
    (CompleteableEvents)?;
QuestExpressions:
    ('quest' (QuestCompletedExpression
    | QuestFailedExpression
    | QuestAcceptedExpression) | ObjectiveExpressions)
    ;
QuestCompletedExpression:
    'completed' target=QuestRef;
QuestFailedExpression:
    'failed' target=QuestRef;
QuestAcceptedExpression:
    'accepted' target=QuestRef;

ObjectiveExpressions:
    'objective' (ObjectiveCompletedExpression
    | ObjectiveFailedExpression)
    ;
ObjectiveCompletedExpression:
    'completed' target=ObjectiveRef;
ObjectiveFailedExpression:
    'failed' target=ObjectiveRef;

//Event
Event:
    'event' name=STRING
    (Description)?
    (codeBlock=CodeBlock)?;
EventTrigger:
    'trigger' target=EventRef;
EventCalledExpression:
    'event' 'triggered' target=EventRef;

//Function
FunctionDeclaration:
    'function' name=ID
    (params+=Parameter)*
    (description=STRING)?
    (codeBlock=CodeBlock)?
    ;
FunctionCall:
   'call' ((predefined?='predefined' predefinedTarget=ID) | target=FunctionRef)  ('with' params+=Expression (',' params+=Expression)*)?;


//Code
CodeBlock:
    (code+=Code)+;
Code:
    FunctionCall
    | VariableAssignment
    | ConditionalBlock
    | EventTrigger
    | VariableDeclaration
    | ReturnStatement
    ;
ConditionalBlock:
    'when' condition=BoolExpression 'do' body+=CodeBlock 'end';
ReturnStatement:
    'return' (returnValue=(Expression))?;
VariableAssignment:
    target=VariableRef '=' value=(Expression);


//General Declarations
VariableDeclaration:
    'let' isComputed='computed'? target=ID '=' value=(Expression);
ObjectDeclaration:
    'object'
    (variables+=VariableDeclaration)*
    (Description)?
    'end';


//Expressions
Expression:
    BoolExpression;

BoolExpression infers Expression:
    exp=ComparisonExpression (
        {infer BoolExpression.left=current} 
        operator=('and' | 'or') 
        right=ComparisonExpression
    )*;
ComparisonExpression infers Expression:
    exp=IntExpression (
        {infer IntToBoolExpression.left=current} 
        operator=('==' | '!=' | '<' | '>' | '<=' | '>=') 
        right=IntExpression
    )?;
IntExpression infers Expression:
    exp=PrimaryExpression (
        {infer IntExpression.left=current} 
        operator=('+' | '-' | '*' | '/') 
        right=PrimaryExpression
    )*;
PrimaryExpression infers Expression:
    {infer GroupedExpression} '(' exp=Expression ')' |
    ReferenceExpression |
    ConstantExpression;
ConstantExpression:
    IntVal | 
    StringVal | 
    BoolVal |
    ObjectDeclaration
    ;
ReferenceExpression:
    FunctionCall |
    QuestExpressions |
    EventCalledExpression |
    RefChain
    ;

//Values
IntVal:        
   isNegative?='-'? val=INT;
BoolVal: 
    isNegated?='not'? val=BooleanValue;
StringVal: 
    val=STRING;
Parameter infers VariableDeclaration:
    'param' name=ID;

//References
RefChain:
    first=RefChainStart ('->' rest+=RefChainItem)*;

RefChainStart:
    VariableRefItem
    | LocationRefItem
    | QuestRefItem
    | EventRefItem;

RefChainItem:
    VariableRefItem
    | LocationRefItem
    | QuestRefItem
    | EventRefItem;
VariableRefItem:
    val=VariableRef;
LocationRefItem:
    isLocation='location' val=LocationRef;
QuestRefItem:
    isQuest='quest' val=QuestRef;
EventRefItem:
    isEvent='event' val=EventRef;

//val is declared, property is generated
VariableRef:        
    val=[VariableDeclaration:ID];
LocationRef:
    val=[Location:STRING];
QuestRef:
    val=[Quest:STRING];
ObjectiveRef:
    val=[Objective:STRING];
EventRef:
    val=[Event:STRING];
FunctionRef:
    val=[FunctionDeclaration:ID];

//Fragments
fragment Description:
    'description' description=STRING;

fragment CompleteableEvents:
    ('enabled' 'on' enabled+=BoolExpression)?
    ('requierement' requierement+=BoolExpression)?
    ('on' ('completed' completed+=CodeBlock) | ('failed' failed+=CodeBlock))*;



// Terminals
terminal BooleanValue returns boolean:
    ('true' | 'false');


hidden terminal WS: /\s+/;
terminal ID: /[_a-zA-Z][\w_]*/;
terminal INT returns number: /[0-9]+/;
terminal STRING: /"(\\.|[^"\\])*"|'(\\.|[^'\\])*'/;

hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
