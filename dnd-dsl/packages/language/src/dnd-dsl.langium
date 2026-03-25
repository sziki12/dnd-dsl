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
    '['property=STRING ((':'|'=') value=ConstantExpression)? ']';

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
QuestCompletedExpression infers BoolExpression:
    'completed' target=QuestRef;
QuestFailedExpression infers BoolExpression:
    'failed' target=QuestRef;
QuestAcceptedExpression infers BoolExpression:
    'accepted' target=QuestRef;

ObjectiveExpressions:
    'objective' (ObjectiveCompletedExpression
    | ObjectiveFailedExpression)
    ;
ObjectiveCompletedExpression infers BoolExpression:
    'completed' target=ObjectiveRef;
ObjectiveFailedExpression infers BoolExpression:
    'failed' target=ObjectiveRef;

//Event
Event:
    'event' name=STRING
    (Description)?
    (codeBlock=CodeBlock)?;
EventTrigger:
    'trigger' target=EventRef;
EventCalledExpression infers BoolExpression:
    'event' 'triggered' target=EventRef;

//Function
FunctionDeclaration:
    'function' name=ID
    (params+=Parameter)*
    (description=STRING)?
    (codeBlock=CodeBlock)?
    ;
FunctionCall:
   'call' ((predefined?='predefined' predefinedTarget=STRING) | target=FunctionRef)  ('with' params+=Expression (',' params+=Expression)*)?;


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
    target=VariableRef '=' value=(Expression | ObjectDeclaration);


//General Declarations
VariableDeclaration:
    'let' name=ID '=' value=(Expression | ObjectDeclaration);
ObjectDeclaration:
    'object'
    (variables+=VariableDeclaration)*
    (Description)?
    'end';


//Expressions
Expression:
    BoolExpression;
BoolExpression:
    ComparisonExpression ({infer BoolExpression.exp1=current} operator=('and' | 'or') exp2=BoolExpression)?;
ComparisonExpression:
    IntExpression ({infer IntToBoolExpression.exp1=current} operator=('==' | '!=' | '<' | '>' | '<=' | '>=') exp2=IntExpression)?;
IntExpression:
    PrimaryExpression ({infer IntExpression.exp1=current} operator=('+' | '-' | '*' | '/') exp2=IntExpression)?;
PrimaryExpression:
    '(' Expression ')'  |
    ReferenceExpression |
    ConstantExpression
    ;
ConstantExpression:
    IntVal | 
    StringVal | 
    BoolVal
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
Ref:
    VariableRef
    | LocationRef
    | QuestRef
    | EventRef;
RefChain:
    (val+=VariableRef | 'location' val+=LocationRef | 'quest' val+=QuestRef | 'event' val+=EventRef) ('->' val+=Ref)*;
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
